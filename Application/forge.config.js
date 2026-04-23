const path = require('node:path');

const windowsIconPath = path.resolve(__dirname, 'assets', 'icon.ico');

module.exports = {
  packagerConfig: {
    asar: true,
    icon: path.resolve(__dirname, 'assets', 'icon'),
    win32metadata: {
      CompanyName: 'REDKING_11',
      FileDescription: 'Calendar App',
      InternalName: 'Calendar App',
      OriginalFilename: 'Calendar App.exe',
      ProductName: 'Calendar App',
      LegalCopyright: 'Copyright (C) 2026 REDKING_11. All rights reserved.',
    },
  },
  rebuildConfig: {},
  makers: [
    {
      name: '@electron-forge/maker-wix',
      platforms: ['win32'],
      config: {
        language: 1033,
        manufacturer: 'REDKING_11',
        nestedFolderName: 'RedFolder',
        programFilesFolderName: 'Calendar',
        icon: windowsIconPath,
      },
    },
    {
      name: '@electron-forge/maker-squirrel',
      config: {},
    },
    {
      name: '@electron-forge/maker-zip',
      platforms: ['win32'],
    },
    {
      name: '@electron-forge/maker-deb',
      config: {},
    },
    {
      name: '@electron-forge/maker-rpm',
      config: {},
    },
  ],
  plugins: [
    {
      name: '@electron-forge/plugin-webpack',
      config: {
        port: 3001,
        loggerPort: 3002,
        mainConfig: './webpack.main.config.js',
        renderer: {
          config: './webpack.renderer.config.js',
          entryPoints: [
            {
              html: './src/renderer/index.html',
              js: './src/renderer/renderer.jsx',
              name: 'main_window',
              preload: {
                js: './src/preload.js',
              },
            },
          ],
        },
      },
    },
  ],
};
