/**
 * Wraps an async Express route handler so rejected promises are
 * forwarded to next(err) instead of crashing the process.
 */
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = asyncHandler;
