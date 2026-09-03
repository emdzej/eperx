// `bz2` ships no types. Only `decompress` is used.
declare module "bz2" {
  const bz2: {
    decompress(input: Uint8Array): Uint8Array;
  };
  export default bz2;
}
