import { Provider } from '../src';
import { NetworkName, SupportedRpcVersion } from '../src/global/constants';
import {
  getDefaultNodes,
  getDefaultNodesAsync,
  getSupportedRpcVersions,
  resolveDefaultNodeUrl,
} from '../src/utils/provider';
import { isVersion, toAnyPatchVersion } from '../src/utils/resolve';

const makeFetchMock = (results: string[]) => {
  let callIndex = 0;
  return jest.fn().mockImplementation(() => {
    const result = results[callIndex];
    callIndex += 1;
    return Promise.resolve(new Response(JSON.stringify({ jsonrpc: '2.0', id: 0, result })));
  });
};

describe('unit tests', () => {
  describe('getDefaultNodes', () => {
    it('constructs correct URLs for all supported RPC versions', () => {
      const supportedVersions = getSupportedRpcVersions();
      supportedVersions.forEach((version) => {
        const rpcNodes = getDefaultNodes(version);
        const [major, minor] = version.replace(/^v/, '').split('.');
        const expectedEnding = `v${major}_${minor}`;
        Object.values(rpcNodes).forEach((networkNodes: any) => {
          networkNodes.forEach((nodeUrl: string) => {
            expect(nodeUrl.endsWith(expectedEnding)).toBe(true);
          });
        });
      });
    });
  });
  describe('getSupportedRpcVersions', () => {
    it('should return a non-empty array of strings', () => {
      const versions = getSupportedRpcVersions();
      expect(Array.isArray(versions)).toBe(true);
      expect(versions.length).toBeGreaterThan(0);
      versions.forEach((version) => {
        expect(typeof version).toBe('string');
      });
    });

    it('should return an array with unique values', () => {
      const versions = getSupportedRpcVersions();
      const uniqueVersions = [...new Set(versions)];
      expect(versions.length).toEqual(uniqueVersions.length);
    });
  });

  describe('getDefaultNodesAsync', () => {
    it('includes deterministic nodes plus matching unknown-versioned candidates', async () => {
      // Only the unknown-versioned candidates are probed (one per network).
      const fetchMock = makeFetchMock(['0.10.2', '0.10.2']);

      const nodes = await getDefaultNodesAsync(SupportedRpcVersion.v0_10_0, {
        baseFetch: fetchMock as unknown as WindowOrWorkerGlobalScope['fetch'],
      });

      expect(nodes.SN_MAIN).toContain('https://api.zan.top/public/starknet-mainnet/rpc/v0_10');
      expect(nodes.SN_MAIN).toContain('https://rpc.starknet.lava.build:443');
      expect(nodes.SN_SEPOLIA).toContain('https://api.zan.top/public/starknet-sepolia/rpc/v0_10');
      expect(nodes.SN_SEPOLIA).toContain('https://rpc.starknet.lava.build:443');
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('excludes unknown-versioned candidates that do not match', async () => {
      const fetchMock = makeFetchMock(['0.8.1', '0.8.1']);

      const nodes = await getDefaultNodesAsync(SupportedRpcVersion.v0_10_0, {
        baseFetch: fetchMock as unknown as WindowOrWorkerGlobalScope['fetch'],
      });

      expect(nodes.SN_MAIN).toContain('https://api.zan.top/public/starknet-mainnet/rpc/v0_10');
      expect(nodes.SN_MAIN).not.toContain('https://rpc.starknet.lava.build:443');
      expect(nodes.SN_SEPOLIA).toContain('https://api.zan.top/public/starknet-sepolia/rpc/v0_10');
      expect(nodes.SN_SEPOLIA).not.toContain('https://rpc.starknet.lava.build:443');
    });
  });

  describe('resolveDefaultNodeUrl', () => {
    it('can return an unknown-versioned candidate when it matches', async () => {
      const fetchMock = makeFetchMock(['0.10.2', '0.10.2']);

      const url = await resolveDefaultNodeUrl(NetworkName.SN_MAIN, SupportedRpcVersion.v0_10_0, {
        baseFetch: fetchMock as unknown as WindowOrWorkerGlobalScope['fetch'],
      });

      expect([
        'https://api.zan.top/public/starknet-mainnet/rpc/v0_10',
        'https://rpc.starknet.lava.build:443',
      ]).toContain(url);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('falls back to deterministic nodes when unknown candidates do not match', async () => {
      const fetchMock = makeFetchMock(['0.8.1', '0.8.1']);

      const url = await resolveDefaultNodeUrl(NetworkName.SN_MAIN, SupportedRpcVersion.v0_10_0, {
        baseFetch: fetchMock as unknown as WindowOrWorkerGlobalScope['fetch'],
      });

      expect(url).toBe('https://api.zan.top/public/starknet-mainnet/rpc/v0_10');
    });
  });
});

describe('Default RPC Nodes', () => {
  test('All Default RPC Nodes support Spec Versions', async () => {
    const supportedVersions = getSupportedRpcVersions();
    const mismatched = await Promise.all(
      supportedVersions.map(async (rpcv) => {
        const rpcNodes = getDefaultNodes(rpcv as SupportedRpcVersion);

        const results = await Promise.all(
          Object.keys(rpcNodes).map(async (network: any) => {
            return Promise.all(
              rpcNodes[network as keyof typeof rpcNodes].map(async (it: any) => {
                const provider = new Provider({ nodeUrl: it });
                let version;
                try {
                  version = await provider.getSpecVersion();
                } catch (error) {
                  version = undefined;
                }

                return {
                  network,
                  nodeUrl: provider.channel.nodeUrl,
                  version,
                };
              })
            );
          })
        );
        // eslint-disable-next-line no-console
        console.table(results.flat());
        return results
          .flat()
          .filter((it: any) => !it.version || !isVersion(toAnyPatchVersion(rpcv), it.version));
      })
    );

    expect(mismatched.flat()).toEqual([]);
  });

  test('resolveDefaultNodeUrl returns a supported node matching the requested version', async () => {
    const supportedVersions = getSupportedRpcVersions();
    const resolved = await Promise.all(
      supportedVersions.map(async (rpcv) => {
        const mainnetUrl = await resolveDefaultNodeUrl(
          NetworkName.SN_MAIN,
          rpcv as SupportedRpcVersion
        );
        const sepoliaUrl = await resolveDefaultNodeUrl(
          NetworkName.SN_SEPOLIA,
          rpcv as SupportedRpcVersion
        );
        return { rpcv, mainnetUrl, sepoliaUrl };
      })
    );

    // eslint-disable-next-line no-console
    console.table(resolved);

    await Promise.all(
      resolved.map(async ({ rpcv, mainnetUrl, sepoliaUrl }) => {
        const expectedPatchVersion = toAnyPatchVersion(rpcv);
        const mainnetProvider = new Provider({ nodeUrl: mainnetUrl });
        const sepoliaProvider = new Provider({ nodeUrl: sepoliaUrl });

        const mainnetVersion = await mainnetProvider.getSpecVersion();
        const sepoliaVersion = await sepoliaProvider.getSpecVersion();

        expect(isVersion(expectedPatchVersion, mainnetVersion)).toBe(true);
        expect(isVersion(expectedPatchVersion, sepoliaVersion)).toBe(true);
      })
    );
  });
});
