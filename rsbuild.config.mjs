// 纯 ESM 配置，供自定义构建脚本直接导入
export default {
  source: {
    entry: {
      background: './src/background/index.ts',
      content: './src/content/index.ts',
      options: './src/options/index.tsx'
    }
  },
  output: {
    distPath: {
      root: 'dist',
      js: 'js',
      css: 'css'
    },
    filenameHash: false,
    cleanDistPath: true,
    copy: [
      { from: './src/manifest.json', to: 'manifest.json' },
      { from: './src/assets', to: 'assets' },
      { from: './src/options/page.html', to: 'options-page.html' }
    ]
  },
  performance: {
    chunkSplit: {
      strategy: 'all-in-one'
    }
  },
  dev: {
    writeToDisk: true,
    hmr: false,
    liveReload: true
  },
  server: {
    port: 3000,
    open: false
  },
  tools: {
    rspack: {
      devtool: 'source-map'
    }
  }
};
