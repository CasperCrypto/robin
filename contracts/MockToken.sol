// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/** A plain ERC20 for tests, with an optional transfer fee so the jackpot's
 *  balance-delta accounting can be exercised against a taxed token. */
contract MockToken {
    string public name = "Mock";
    string public symbol = "MOCK";
    uint8  public decimals = 18;
    uint256 public totalSupply;
    uint16 public feeBps;                       // taken on every transfer

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    constructor(uint16 feeBps_) { feeBps = feeBps_; }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
    }
    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }
    function _move(address from, address to, uint256 amount) internal {
        require(balanceOf[from] >= amount, "balance");
        uint256 fee = (amount * feeBps) / 10_000;
        balanceOf[from] -= amount;
        balanceOf[to] += amount - fee;
        if (fee > 0) balanceOf[address(0xdead)] += fee;
    }
    function transfer(address to, uint256 amount) external returns (bool) {
        _move(msg.sender, to, amount);
        return true;
    }
    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(allowance[from][msg.sender] >= amount, "allowance");
        allowance[from][msg.sender] -= amount;
        _move(from, to, amount);
        return true;
    }
}
