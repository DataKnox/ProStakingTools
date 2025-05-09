const webpack = require('webpack');

module.exports = {
    webpack: {
        configure: {
            resolve: {
                fallback: {
                    "crypto": require.resolve("crypto-browserify"),
                    "stream": require.resolve("stream-browserify"),
                    "assert": require.resolve("assert"),
                    "http": require.resolve("stream-http"),
                    "https": require.resolve("https-browserify"),
                    "os": require.resolve("os-browserify"),
                    "url": require.resolve("url"),
                    "buffer": require.resolve("buffer"),
                    "process": require.resolve("process/browser.js")
                }
            },
            plugins: [
                new webpack.ProvidePlugin({
                    process: 'process/browser.js',
                    Buffer: ['buffer', 'Buffer']
                })
            ],
            module: {
                rules: [
                    {
                        test: /\.m?js/,
                        resolve: {
                            fullySpecified: false
                        }
                    }
                ]
            }
        }
    }
}; 