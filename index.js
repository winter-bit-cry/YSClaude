require('react-native-gesture-handler');

const { AppRegistry } = require('react-native');
AppRegistry.registerHeadlessTask('YSClaudeWorkflowTask', () => async (data) => {
  const { handleWorkflowHeadlessTask } = require('./src/services/workflowRunner');
  await handleWorkflowHeadlessTask(data);
});

require('expo-router/entry');
