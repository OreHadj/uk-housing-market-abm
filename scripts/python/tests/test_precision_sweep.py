from __future__ import annotations

import unittest

from scripts.python.experiments.model.precision_sweep import (
    ARM_REGISTRY,
    classify_failure,
    parse_arms,
)


class PrecisionSweepTest(unittest.TestCase):
    def test_arm_parser_preserves_requested_order(self) -> None:
        self.assertEqual(
            [arm.arm_id for arm in parse_arms("H64,HQ52,HQ23")],
            ["H64", "HQ52", "HQ23"],
        )

    def test_q52_is_a_mantissa_noop_arm_not_the_fp64_reference(self) -> None:
        self.assertEqual(ARM_REGISTRY["H64"].mode, "fp64")
        self.assertEqual(ARM_REGISTRY["HQ52"].mode, "mantissa")
        self.assertEqual(ARM_REGISTRY["HQ52"].mantissa_bits, 52)

    def test_down_payment_invariant_is_classified_with_hyphen(self) -> None:
        output = (
            "Bank.requestApproval produced a down-payment larger than liquid wealth "
            "at timeStep=0"
        )
        self.assertEqual(classify_failure(output), "invalid-model-invariant")

    def test_unknown_failure_stays_an_execution_failure(self) -> None:
        self.assertEqual(classify_failure("Exception: unexpected"), "execution-failure")


if __name__ == "__main__":
    unittest.main()
