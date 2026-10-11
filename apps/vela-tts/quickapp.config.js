const { rspack } = require('@rspack/core');

module.exports = {
  webpack: {
    optimization: {
      minimize: true,
      minimizer: [
        new rspack.SwcJsMinimizerRspackPlugin({
          minimizerOptions: { module: true }
        })
      ]
    }
  }
};
