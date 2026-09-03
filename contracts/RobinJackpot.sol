// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * RobinJackpot — a provably fair token jackpot.
 *
 * Players send $ROBIN into a round. When the round closes the operator reveals
 * a seed it committed to *before anyone could enter*, and that seed picks the
 * winner. The winner takes the pot minus a capped rake.
 *
 * The design is shaped by one question: what can the operator do if its key is
 * stolen? The answer has to be "almost nothing", because the key has to live
 * on a server to run rounds automatically.
 *
 *   - There is no function that moves the pot anywhere except to the winner
 *     the committed seed selects, or back to the players. Not an owner
 *     withdrawal, not a rescue, not a pause-and-drain. None.
 *   - The seed is committed before entries open, so the operator cannot see
 *     the entries and then choose a seed that suits it.
 *   - The rake is fixed at construction and capped at 5%, so it cannot be
 *     raised later toward 100%.
 *   - If the operator never reveals — key lost, key stolen, server gone —
 *     anyone can open refunds after a grace period and every player pulls
 *     their own stake back out. A silent operator costs players time, never
 *     money.
 *
 * The worst a compromised operator key can do is refuse to draw, which turns
 * into refunds.
 *
 * NOT AUDITED. Test on a testnet with amounts you would not mind losing before
 * pointing real money at it.
 */

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

contract RobinJackpot {
    /* ── configuration, all fixed at deployment ─────────────────────────── */
    IERC20  public immutable token;
    address public immutable treasury;      // where the rake goes
    uint16  public immutable rakeBps;       // capped below
    uint32  public immutable entryWindow;   // seconds a round accepts entries
    uint32  public immutable graceWindow;   // …then this long to reveal, or refunds

    uint16  public constant MAX_RAKE_BPS = 500;    // 5%, and this is a constant
    uint16  public constant MAX_PLAYERS  = 500;    // bounds the winner search
    uint256 public constant MIN_ENTRY    = 1e18;   // one whole token

    address public operator;

    enum Status { None, Open, Drawn, Refunding }

    struct Round {
        Status  status;
        uint64  closesAt;
        bytes32 seedHash;
        bytes32 seed;
        uint256 pot;
        uint256 ticket;
        address winner;
        address[] players;
    }

    uint256 public currentRound;
    mapping(uint256 => Round) private rounds;
    mapping(uint256 => mapping(address => uint256)) public staked;

    event RoundOpened(uint256 indexed round, bytes32 seedHash, uint64 closesAt);
    event Entered(uint256 indexed round, address indexed player, uint256 amount, uint256 pot);
    event Drawn(uint256 indexed round, address indexed winner, uint256 prize, uint256 rake, bytes32 seed, uint256 ticket);
    event RefundsOpened(uint256 indexed round);
    event Refunded(uint256 indexed round, address indexed player, uint256 amount);
    event OperatorChanged(address indexed from, address indexed to);

    error NotOperator();
    error WrongStatus();
    error TooSmall();
    error RoundFull();
    error StillOpen();
    error TooLate();
    error BadSeed();
    error NothingToRefund();
    error RakeTooHigh();
    error ZeroAddress();
    error TransferFailed();

    modifier onlyOperator() {
        if (msg.sender != operator) revert NotOperator();
        _;
    }

    constructor(
        address token_,
        address treasury_,
        uint16  rakeBps_,
        uint32  entryWindow_,
        uint32  graceWindow_
    ) {
        if (token_ == address(0) || treasury_ == address(0)) revert ZeroAddress();
        if (rakeBps_ > MAX_RAKE_BPS) revert RakeTooHigh();
        token       = IERC20(token_);
        treasury    = treasury_;
        rakeBps     = rakeBps_;
        entryWindow = entryWindow_;
        graceWindow = graceWindow_;
        operator    = msg.sender;
    }

    /* ── running a round ────────────────────────────────────────────────── */

    /**
     * Open the next round, committing to a seed nobody can see yet.
     * Publish `seedHash` on the site before this transaction confirms and the
     * commitment is checkable by anyone, at any time afterwards.
     */
    function openRound(bytes32 seedHash) external onlyOperator returns (uint256 id) {
        // The live round has to be finished first. draw() and openRefunds()
        // only ever act on the current round, so moving the pointer past a
        // round that still holds stakes would strand every one of them with no
        // way to draw it and no way to refund it. Finish, then open.
        uint256 prev = currentRound;
        if (prev != 0 && rounds[prev].status == Status.Open) revert WrongStatus();

        id = ++currentRound;
        Round storage r = rounds[id];
        if (r.status != Status.None) revert WrongStatus();
        r.status   = Status.Open;
        r.seedHash = seedHash;
        r.closesAt = uint64(block.timestamp + entryWindow);
        emit RoundOpened(id, seedHash, r.closesAt);
    }

    /**
     * Enter the open round. Approve this contract for `amount` first.
     *
     * The amount credited is what actually arrived, not what was asked for, so
     * a token that takes a cut on transfer cannot leave the contract promising
     * more than it holds.
     */
    function enter(uint256 amount) external {
        uint256 id = currentRound;
        Round storage r = rounds[id];
        if (r.status != Status.Open) revert WrongStatus();
        if (block.timestamp >= r.closesAt) revert TooLate();
        if (amount < MIN_ENTRY) revert TooSmall();

        uint256 before = token.balanceOf(address(this));
        if (!token.transferFrom(msg.sender, address(this), amount)) revert TransferFailed();
        uint256 received = token.balanceOf(address(this)) - before;
        if (received < MIN_ENTRY) revert TooSmall();

        if (staked[id][msg.sender] == 0) {
            if (r.players.length >= MAX_PLAYERS) revert RoundFull();
            r.players.push(msg.sender);
        }
        staked[id][msg.sender] += received;
        r.pot += received;
        emit Entered(id, msg.sender, received, r.pot);
    }

    /**
     * Reveal the seed and pay the winner.
     *
     * The ticket is a number in [0, pot). Walking the players in entry order
     * and stopping when the running total passes it makes a player's chance
     * exactly their share of the pot.
     */
    function draw(bytes32 seed) external onlyOperator {
        uint256 id = currentRound;
        Round storage r = rounds[id];
        if (r.status != Status.Open) revert WrongStatus();
        if (block.timestamp < r.closesAt) revert StillOpen();
        if (keccak256(abi.encodePacked(seed)) != r.seedHash) revert BadSeed();

        // Nobody played, or only one did: there is nothing to draw. Refunds
        // return the single stake untouched.
        if (r.players.length < 2) {
            r.status = Status.Refunding;
            r.seed = seed;
            emit RefundsOpened(id);
            return;
        }

        uint256 ticket = uint256(keccak256(abi.encodePacked(seed, id))) % r.pot;
        uint256 acc;
        address winner = r.players[0];
        for (uint256 i = 0; i < r.players.length; i++) {
            acc += staked[id][r.players[i]];
            if (ticket < acc) { winner = r.players[i]; break; }
        }

        uint256 rake  = (r.pot * rakeBps) / 10_000;
        uint256 prize = r.pot - rake;

        r.status = Status.Drawn;
        r.seed   = seed;
        r.ticket = ticket;
        r.winner = winner;

        if (rake > 0 && !token.transfer(treasury, rake)) revert TransferFailed();
        if (!token.transfer(winner, prize)) revert TransferFailed();
        emit Drawn(id, winner, prize, rake, seed, ticket);
    }

    /**
     * If the operator has not drawn within the grace period, anyone may open
     * refunds. This is the escape hatch that makes a lost or stolen operator
     * key survivable.
     */
    function openRefunds() external {
        uint256 id = currentRound;
        Round storage r = rounds[id];
        if (r.status != Status.Open) revert WrongStatus();
        if (block.timestamp < uint256(r.closesAt) + graceWindow) revert StillOpen();
        r.status = Status.Refunding;
        emit RefundsOpened(id);
    }

    /** Take your own stake back out of a refunding round. */
    function claimRefund(uint256 id) external {
        Round storage r = rounds[id];
        if (r.status != Status.Refunding) revert WrongStatus();
        uint256 amount = staked[id][msg.sender];
        if (amount == 0) revert NothingToRefund();

        staked[id][msg.sender] = 0;      // effects before interaction
        r.pot -= amount;
        if (!token.transfer(msg.sender, amount)) revert TransferFailed();
        emit Refunded(id, msg.sender, amount);
    }

    /** Hand the running of rounds to another key. Moves no money. */
    function setOperator(address next) external onlyOperator {
        if (next == address(0)) revert ZeroAddress();
        emit OperatorChanged(operator, next);
        operator = next;
    }

    /* ── views ──────────────────────────────────────────────────────────── */
    function roundInfo(uint256 id) external view returns (
        Status status, uint64 closesAt, bytes32 seedHash, bytes32 seed,
        uint256 pot, uint256 ticket, address winner, uint256 playerCount
    ) {
        Round storage r = rounds[id];
        return (r.status, r.closesAt, r.seedHash, r.seed, r.pot, r.ticket, r.winner, r.players.length);
    }

    function playersOf(uint256 id) external view returns (address[] memory) {
        return rounds[id].players;
    }

    function stakesOf(uint256 id) external view returns (address[] memory who, uint256[] memory amounts) {
        who = rounds[id].players;
        amounts = new uint256[](who.length);
        for (uint256 i = 0; i < who.length; i++) amounts[i] = staked[id][who[i]];
    }
}
