module.exports = [
  {
    test: /\.(js|jsx)$/,
    exclude: /node_modules/,
    use: {
      loader: 'babel-loader',
      options: {
        presets: [
          ['@babel/preset-env', { targets: { electron: '41' } }],
          ['@babel/preset-react', { runtime: 'automatic' }],
        ],
      },
    },
  },
];
