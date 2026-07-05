import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';
import { cp } from 'node:fs/promises';
import path from 'node:path';

const config: ForgeConfig = {
  packagerConfig: {
    // The whole @duckdb scope must live outside the asar: duckdb.node
    // dynamically links libduckdb.so from the same directory, and dlopen
    // cannot read either from inside the archive. A plain '**/*.node'
    // unpack (plugin-auto-unpack-natives) misses the .so — hence the
    // explicit pattern instead of the plugin.
    asar: {
      unpack: '**/node_modules/@duckdb/**',
    },
  },
  hooks: {
    // The Vite plugin packages only the bundled .vite output; modules
    // externalized in vite.main.config.ts (the DuckDB native addon) must be
    // copied into the app ourselves. The whole @duckdb scope is
    // self-contained: node-api → node-bindings → platform binding.
    packageAfterCopy: async (_config, buildPath) => {
      await cp(
        path.resolve(__dirname, 'node_modules', '@duckdb'),
        path.join(buildPath, 'node_modules', '@duckdb'),
        { recursive: true },
      );
    },
  },
  rebuildConfig: {},
  makers: [
    new MakerSquirrel({}),
    new MakerZIP({}, ['darwin']),
    new MakerRpm({}),
    new MakerDeb({}),
  ],
  plugins: [
    new VitePlugin({
      build: [
        {
          entry: 'src/main/main.ts',
          config: 'vite.main.config.ts',
          target: 'main',
        },
        {
          entry: 'src/preload.ts',
          config: 'vite.preload.config.ts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.ts',
        },
      ],
    }),
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
