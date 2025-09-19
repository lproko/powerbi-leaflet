const path = require("path");
const CopyWebpackPlugin = require("copy-webpack-plugin");

module.exports = {
  entry: "./src/visual.ts",
  devtool: 'false', // Use eval mode to avoid CSP issues while keeping some debugging capability
  output: {
    path: path.resolve(__dirname, "dist"),
    filename: "visual.js",
    library: "powerbiCustomVisuals",
    libraryTarget: "var",
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: "ts-loader",
        exclude: /node_modules/,
      },
      {
        test: /\.css$/,
        use: ["style-loader", "css-loader"],
      },
    ],
  },
  resolve: {
    extensions: [".tsx", ".ts", ".js", ".css"],
  },
  plugins: [
    new CopyWebpackPlugin({
      patterns: [
        {
          from: "plh-map.geojson",
          to: "plh-map.geojson",
        },
      ],
    }),
  ],
};
