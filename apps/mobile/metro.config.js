const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");
const path = require("path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");
const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.disableHierarchicalLookup = true;
config.resolver.nodeModulesPaths = [
    path.resolve(projectRoot, "node_modules"),
    path.resolve(workspaceRoot, "node_modules"),
];
config.resolver.extraNodeModules = {
    react: path.resolve(projectRoot, "node_modules/react"),
    "react/jsx-runtime": path.resolve(projectRoot, "node_modules/react/jsx-runtime.js"),
    "react/jsx-dev-runtime": path.resolve(projectRoot, "node_modules/react/jsx-dev-runtime.js"),
    "react-native": path.resolve(projectRoot, "node_modules/react-native"),
    "@react-navigation/native": path.resolve(projectRoot, "node_modules/@react-navigation/native"),
    "@react-navigation/core": path.resolve(projectRoot, "node_modules/@react-navigation/core"),
    "@react-navigation/bottom-tabs": path.resolve(projectRoot, "node_modules/@react-navigation/bottom-tabs"),
    "@react-navigation/stack": path.resolve(projectRoot, "node_modules/@react-navigation/stack"),
    "@react-navigation/elements": path.resolve(projectRoot, "node_modules/@react-navigation/elements"),
    "@tanstack/react-query": path.resolve(projectRoot, "node_modules/@tanstack/react-query"),
    "@tanstack/query-core": path.resolve(projectRoot, "node_modules/@tanstack/query-core"),
};

module.exports = withNativeWind(config, { input: "./global.css" });