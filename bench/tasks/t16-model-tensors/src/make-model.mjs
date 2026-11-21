// Writes model.safetensors: a header that names six tensors, followed by
// zero bytes of the sizes the header declares. No clock, no randomness.
import { writeFileSync } from "node:fs";

const BYTES = { F32: 4, F16: 2, I64: 8 };
const tensors = [
  ["embed.weight", "F16", [512, 64]],
  ["encoder.layer0.attention.weight", "F32", [64, 64]],
  ["encoder.layer0.attention.bias", "F32", [64]],
  ["classifier.weight", "F32", [7, 64]],
  ["classifier.bias", "F32", [7]],
  ["vocab.offsets", "I64", [513]],
];

let offset = 0;
const header = {
  __metadata__: { format: "pt", task: "parcel-intent", trained_on: "2026-03-18" },
};
for (const [name, dtype, shape] of tensors) {
  const size = shape.reduce((count, extent) => count * extent, 1) * BYTES[dtype];
  header[name] = { dtype, shape, data_offsets: [offset, offset + size] };
  offset += size;
}

let text = JSON.stringify(header);
text += " ".repeat((8 - (text.length % 8)) % 8);
const length = Buffer.alloc(8);
length.writeBigUInt64LE(BigInt(text.length));
writeFileSync(process.argv[2], Buffer.concat([length, Buffer.from(text, "utf8"), Buffer.alloc(offset)]));
