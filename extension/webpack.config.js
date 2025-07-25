const path = require('path');

module.exports = {
  mode: 'development',
  entry: {
    audioContent: './src/contentScripts/audioContent.ts',
    popup: './src/static/popup/popup.ts',
    background: './src/background.ts'
  },
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: '[name].js'
  },
  resolve: {
    extensions: ['.ts', '.js']
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        use: 'ts-loader',
        exclude: /node_modules/
      }
    ]
  },
  devtool: 'source-map'
};
