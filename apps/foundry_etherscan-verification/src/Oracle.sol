// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

contract Oracle {
    uint256 public by;

    event Updated(uint256 by);

    function set(uint256 _by) public {
        by = _by;
        emit Updated(_by);
    }
}
