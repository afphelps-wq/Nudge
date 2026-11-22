// Stand-in for expo-haptics in the Node logic tests: records calls, vibrates nothing.

export const NotificationFeedbackType = { Success: 'success', Warning: 'warning', Error: 'error' };
export const ImpactFeedbackStyle = {
  Light: 'light',
  Medium: 'medium',
  Heavy: 'heavy',
  Soft: 'soft',
  Rigid: 'rigid',
};

export const __haptics = { calls: [] };

export async function notificationAsync(type) {
  __haptics.calls.push(['notification', type]);
}

export async function impactAsync(style) {
  __haptics.calls.push(['impact', style]);
}
