function requireEnv(name: "EXPO_PUBLIC_API_URL" | "EXPO_PUBLIC_SOCKET_URL") {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`${name} is not set`);
  }

  return value.replace(/\/$/, "");
}

export const ENV = {
  API_URL: requireEnv("EXPO_PUBLIC_API_URL"),
  SOCKET_URL: requireEnv("EXPO_PUBLIC_SOCKET_URL"),
};