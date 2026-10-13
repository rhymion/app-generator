export function encryptFileName(name: string) {
  return { uuid: `enc-${name}`, encryptedName: `ciphertext-${name}`, iv: 'iv' };
}
