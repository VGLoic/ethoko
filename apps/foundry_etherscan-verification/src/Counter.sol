// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import {InternalMath} from "./InternalMath.sol";
import {ExternalMath} from "./ExternalMath.sol";
import {Oracle} from "./Oracle.sol";

contract Counter {
    using InternalMath for uint256;
    using ExternalMath for uint256;

    uint256 public x;
    Oracle public oracle;

    event Increment(uint256 by);
    event Multiply(uint256 by);

    constructor(Oracle _oracle) {
        oracle = _oracle;
    }

    function inc() public {
        uint256 by = oracle.by();
        x = x.add(by);
        emit Increment(by);
    }

    function mul() public {
        uint256 by = oracle.by();
        x = x.mul(by);
        emit Multiply(by);
    }
}
