// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import {InternalMath} from "./InternalMath.sol";
import {ExternalMath} from "./ExternalMath.sol";
import {Oracle} from "./Oracle.sol";

contract Counter {
    using InternalMath for uint;
    using ExternalMath for uint;

    uint public x;
    Oracle public oracle;

    event Increment(uint by);
    event Multiply(uint by);

    constructor(Oracle _oracle) {
        oracle = _oracle;
    }

    function inc() public {
        uint by = oracle.by();
        x = x.add(by);
        emit Increment(by);
    }

    function mul() public {
        uint by = oracle.by();
        x = x.mul(by);
        emit Multiply(by);
    }
}
