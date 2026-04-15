const NUMBER_RANGES = {
  byte: {
    min: -128,
    max: 127
  },
  short: {
    min: -32768,
    max: 32767
  },
  int: {
    min: -2147483648,
    max: 2147483647
  },
  long: {
    min: -9223372036854775808n,
    max: 9223372036854775807n
  },
  float: {
    min: -3.4028235e+38,
    max: 3.4028235e+38,
    smallest: 1.4e-45,
    smallestNegative: -1.4e-45,
    maxSafeInt: 16777215,
    minSafeInt: -16777215
  },
  double: {
    min: -1.7976931348623157e+308,
    max: 1.7976931348623157e+308,
    smallest: 4.9e-324, // shows in JS as 5e-324
    smallestNegative: -4.9e-324, // shows in JS as -5e-324
    maxSafeInt: 9007199254740991,
    minSafeInt: -9007199254740991
  }
}

////////////////////////////////

const DEDUP_SYM = Symbol("dedup")
// array is assumed to be constant
function dedup(arr) {
  if (arr[DEDUP_SYM]) return arr[DEDUP_SYM]

  let set = new Set(arr)
  if (set.size < arr.length) {
    arr = arr[DEDUP_SYM] = [...set]
  }

  return arr[DEDUP_SYM] = arr
}
