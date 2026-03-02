// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import {Test} from "forge-std/Test.sol";
import {Counter} from "../src/Counter.sol";
import {Oracle} from "../src/Oracle.sol";

contract CounterTest is Test {
    Oracle public oracle;
    Counter public counter;

    function setUp() public {
        oracle = new Oracle();
        counter = new Counter(oracle);
        oracle.set(3);
    }

    function test_Increment() public {
        counter.inc();
        assertEq(counter.x(), 3);
    }
}
