// Minimal stand-in for react-native in the Node logic tests. Only the handful
// of non-UI APIs that the lib modules touch are provided.

export const LogBox = {
  ignoreLogs() {},
  ignoreAllLogs() {},
};

export const Platform = {
  OS: 'ios',
  select: (options) => options.ios ?? options.default,
};

export const AppState = {
  currentState: 'active',
  addEventListener() {
    return { remove() {} };
  },
};

export const Linking = {
  async openSettings() {},
};

export const Alert = {
  alert() {},
};
