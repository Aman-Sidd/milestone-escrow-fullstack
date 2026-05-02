// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// OpenZeppelin imports
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract MockUSDT is ERC20, Ownable {
    // USDT uses 6 decimals instead of 18
    uint8 private constant _DECIMALS = 6;

    // Hardcoded supply: 1,000,000 USDT (with 6 decimals)
    uint256 private constant INITIAL_SUPPLY = 1_000_000 * 10**6;

    constructor() ERC20("Mock USDT", "USDT") Ownable(msg.sender) {
        _mint(msg.sender, INITIAL_SUPPLY);
    }

    // Override decimals to match USDT
    function decimals() public pure override returns (uint8) {
        return _DECIMALS;
    }
}