module.exports = ({ config }) => {
  const licenseServiceUrl =
    process.env.EXPO_PUBLIC_LICENSE_SERVICE_URL ||
    process.env.LICENSE_SERVICE_URL ||
    config.extra?.licenseServiceUrl;

  return {
    ...config,
    extra: {
      ...config.extra,
      licenseServiceUrl,
    },
  };
};
