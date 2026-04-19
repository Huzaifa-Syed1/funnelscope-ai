/**
 * openai.service.js — STUBBED
 * OpenAI dependency removed. All AI analysis is now computed
 * client-side by funnel-diagnosis.js using local rule-based logic.
 */
export async function generateFunnelAnalysis() {
  return {
    text:       'AI insights computed locally.',
    responseId: 'local',
    model:      'local-rules-v1',
    usage:      null
  };
}

export async function getAIInsights() {
  return {
    summary: 'AI insights coming soon',
    fixes: [
      'Reduce friction in signup',
      'Improve CTA clarity',
      'Add trust signals'
    ]
  };
}
