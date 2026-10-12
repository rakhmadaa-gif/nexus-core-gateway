export class Wallet {
  address = "0x0000000000000000000000000000000000000001";
  constructor(_k?: any, _p?: any) {}
  signTypedData = async (_d: any, _t: any, _m: any) => "0x" + "00".repeat(65);
  sendTransaction = async (_tx: any) => ({ hash: "0x" + "00".repeat(32), wait: async () => ({ status: 1 }) });
  connect(_p: any) { return this; }
}
export class Contract {
  constructor(_a?: any, _abi?: any, _p?: any) {}
  static from() { return {}; }
}
export class JsonRpcProvider {
  constructor(_u?: any) {}
  getTransactionReceipt = async (_h: any) => null;
  getTransaction = async (_h: any) => null;
  getBalance = async (_a: any) => 0n;
  getFeeData = async () => ({ gasPrice: 30_000_000_000n, maxFeePerGas: null, maxPriorityFeePerGas: null });
  getBlockNumber = async () => 1;
  getNetwork = async () => ({ chainId: 137n });
}
export const verifyTypedData = (_d: any, _t: any, _m: any, _s: any) => "0x0000000000000000000000000000000000000001";
export const keccak256 = (_b: any) => "0x" + "ab".repeat(32);
export const toUtf8Bytes = (s: string) => new Uint8Array([...s].map((c) => c.charCodeAt(0) & 255));
export class Signature {
  static from(_s: any) { return new Signature(); }
  r = "0x" + "00".repeat(32);
  s = "0x" + "00".repeat(32);
  v = 27;
  get serialized() { return "0x" + "00".repeat(65); }
}
export class SigningKey {
  static computePublicKey(_k: any) { return "0x" + "00".repeat(33); }
}
export class TypedDataEncoder {
  static hash(_d: any, _t: any, _m: any) { return "0x" + "ab".repeat(32); }
  static hashStruct(_n: any, _t: any, _m: any) { return "0x" + "ab".repeat(32); }
  static resolveNames = async (_d: any, _t: any, _m: any, _v: any) => _m;
}
export const getBytes = (b: any) => b;
export const solidityPackedKeccak256 = (_t: any, _v: any) => "0x" + "ab".repeat(32);
export const AbiCoder = { defaultAbiCoder: () => ({ encode: (..._a: any[]) => "0x", decode: (..._a: any[]) => [] }) };
export const Interface = class { constructor(_abi?: any) {} encodeFunctionData(..._a: any[]) { return "0x"; } };
export const isAddress = (a: any) => typeof a === "string" && a.startsWith("0x");
