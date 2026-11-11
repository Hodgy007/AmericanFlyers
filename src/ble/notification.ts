/** Bluefy may deliver updates on another characteristic object, or as raw bytes. */
export function notificationView(event: Event | undefined, characteristic: Pick<BluetoothRemoteGATTCharacteristic, 'value'>): DataView | null {
  const value: unknown = (event?.target as BluetoothRemoteGATTCharacteristic | null | undefined)?.value ?? characteristic.value;
  try {
    if (ArrayBuffer.isView(value)) return new DataView(value.buffer, value.byteOffset, value.byteLength);
    if (value instanceof ArrayBuffer) return new DataView(value);
  } catch { /* a detached or malformed value: wait for the next notification */ }
  return null;
}
