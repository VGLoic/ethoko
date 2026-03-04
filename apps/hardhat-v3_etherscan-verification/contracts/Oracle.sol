// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract Oracle is Ownable {
    uint public by;

    constructor(address initialOwner) Ownable(initialOwner) {}

    event Updated(uint by);

    function set(uint _by) public onlyOwner {
        by = _by;
        emit Updated(_by);
    }
}
