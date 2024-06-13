const path = require("path");

module.exports = {
  entry: "./src/visual.ts",
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
};
