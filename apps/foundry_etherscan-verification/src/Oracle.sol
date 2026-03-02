// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

contract Oracle {
    uint public by;

    event Updated(uint by);

    function set(uint _by) public {
        by = _by;
        emit Updated(_by);
    }
}
