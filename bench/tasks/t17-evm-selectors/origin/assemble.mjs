// Assembles src/contract.hex: the runtime bytecode of a contract with a plain
// selector dispatcher and four functions that each return one word.
// usage: node assemble.mjs > ../src/contract.hex
const SELECTORS = ["70a08231", "a9059cbb", "18160ddd", "3ccfd60b"];

const hex = (value, bytes) => value.toString(16).padStart(bytes * 2, "0");

// PUSH1 0x80 PUSH1 0x40 MSTORE (5 bytes); PUSH1 4 CALLDATASIZE LT PUSH2
// fallback JUMPI (8); PUSH0 CALLDATALOAD PUSH1 0xe0 SHR (5)
const HEAD_BYTES = 18;
// DUP1 PUSH4 selector EQ PUSH2 target JUMPI
const CASE_BYTES = 11;
// JUMPDEST PUSH0 DUP1 REVERT STOP
const FALLBACK = "5b5f80fd00";
// JUMPDEST PUSH1 n PUSH0 MSTORE PUSH1 0x20 PUSH0 RETURN
const BODY_BYTES = 8;

const fallbackAt = HEAD_BYTES + CASE_BYTES * SELECTORS.length;
const bodiesAt = fallbackAt + FALLBACK.length / 2;

let code = `60806040526004361061${hex(fallbackAt, 2)}575f3560e01c`;
SELECTORS.forEach((selector, index) => {
  code += `8063${selector}1461${hex(bodiesAt + index * BODY_BYTES, 2)}57`;
});
code += FALLBACK;
SELECTORS.forEach((_selector, index) => {
  code += `5b60${hex(index + 1, 1)}5f5260205ff3`;
});
process.stdout.write(`0x${code}\n`);
