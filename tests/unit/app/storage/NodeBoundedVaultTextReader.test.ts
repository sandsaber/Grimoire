import {
  type BoundedFileSystemPort,
  NodeBoundedVaultTextReader,
} from '@/app/storage/NodeBoundedVaultTextReader';

describe('NodeBoundedVaultTextReader', () => {
  it('reads a stable file through a max-plus-one descriptor buffer', async () => {
    const bytes = new TextEncoder().encode('bounded');
    const fixture = fileSystem(bytes, bytes.byteLength);
    const reader = new NodeBoundedVaultTextReader({ getBasePath: () => '/vault' }, fixture.port);

    await expect(reader.readBounded('results/item.json', 16)).resolves.toBe('bounded');
    expect(fixture.requestedLengths[0]).toBe(17);
    expect(fixture.requestedLengths.every(length => length <= 17)).toBe(true);
    expect(fixture.closed).toHaveLength(1);
  });

  it('rejects growth after the initial stat without requesting more than max plus one bytes', async () => {
    const bytes = new TextEncoder().encode('x'.repeat(65));
    const fixture = fileSystem(bytes, 2);
    const reader = new NodeBoundedVaultTextReader({ getBasePath: () => '/vault' }, fixture.port);

    await expect(reader.readBounded('results/item.json', 64)).rejects.toThrow('byte limit');
    expect(fixture.requestedLengths).toEqual([65]);
    expect(fixture.closed).toHaveLength(1);
  });

  it('rejects paths outside the vault before opening a descriptor', async () => {
    const fixture = fileSystem(new Uint8Array(), 0);
    const reader = new NodeBoundedVaultTextReader({ getBasePath: () => '/vault' }, fixture.port);

    await expect(reader.readBounded('../outside', 64)).rejects.toThrow('escapes');
    expect(fixture.opened).toEqual([]);
  });
});

function fileSystem(bytes: Uint8Array, initialSize: number) {
  const opened: string[] = [];
  const closed: boolean[] = [];
  const requestedLengths: number[] = [];
  let read = false;
  const metadata = (size: number) => ({
    dev: 1,
    ino: 2,
    size,
    mtimeMs: 3,
    isFile: () => true,
  });
  const port: BoundedFileSystemPort = {
    open: async path => {
      opened.push(path);
      return {
        stat: async () => metadata(initialSize),
        read: async (buffer, offset, length) => {
          requestedLengths.push(length);
          if (read) return { bytesRead: 0 };
          read = true;
          const count = Math.min(length, bytes.byteLength);
          buffer.set(bytes.subarray(0, count), offset);
          return { bytesRead: count };
        },
        close: async () => { closed.push(true); },
      };
    },
    stat: async () => metadata(bytes.byteLength),
  };
  return { port, opened, closed, requestedLengths };
}
