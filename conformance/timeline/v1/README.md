# Route Timeline v1 Conformance

This package is renderer-neutral. `vectors.json` contains readable programs,
mock bindings, samples, domain/easing/expression/modifier/random vectors, event
crossings, and Unicode 17 text boundaries. Times are integer milliseconds;
interior floating-point comparisons use the declared tolerance and endpoints
must be exact.

`reference-evaluator.mjs` is an intentionally independent evaluator for the
small scalar/constant/linear subset used by the first program fixture. It does
not import the production evaluator. A native implementation should validate
the complete `route.timeline/v1` program contract, then use the vectors as a
minimum compatibility suite.
