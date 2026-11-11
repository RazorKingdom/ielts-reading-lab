import { OFFLINE_EXPLANATIONS } from '../data/explanations'
import type { SentenceAnalysis } from './types'
import { analyzeSentence } from './targets'

/**
 * Every sentence in the 100 built-in passages ships with a Chinese reference
 * reading and an SVO skeleton. This merges them into the normal local analysis.
 * Only `skeleton`, `meaning`, `layers` and `followUps` are upgraded: chunks,
 * phrases and diagnostic targets stay exactly as the local rule engine made
 * them, so the teaching engine and Validator are unaffected. Zero network,
 * zero AI, no fee.
 */

interface Reading {
  meaning: string
  category: string
  skeleton?: { subject: string; predicate: string; object: string }
}

const READINGS = new Map<string, Reading>(
  OFFLINE_EXPLANATIONS.map(([sentenceId, meaning, category, subject, predicate, object]) => [
    sentenceId,
    {
      meaning,
      category,
      skeleton: subject && predicate ? { subject, predicate, object } : undefined,
    },
  ]),
)

const LAYERS: Record<string, string[]> = {
  LEAD: [
    '本句引出段落主题，点明要讨论的变量与场景。',
    '留意后面的句子如何展开、限定或反驳这一变量。',
    '引导句本身不是研究结论。',
  ],
  OPEN: [
    '主干交代研究背景与时间段。',
    '后半句说明成本或关注度变化带来的影响。',
    '背景描述不构成因果推断。',
  ],
  FACT: [
    '主干是「研究 / 观察表明 + 具体发现」。',
    'although / but / though 之后是对结论适用范围的限定。',
    '注意区分观察到的关联与已被证实的因果。',
  ],
  METHOD: [
    '主干说明这项分析采用了什么方法。',
    '后半句解释该方法解决了什么问题，或留下了什么缺口。',
    '方法描述不等于研究发现。',
  ],
  QUAL: [
    '主干指出某个变量对结果的影响。',
    '比较结构给出变量之间的相对权重。',
    '限定语缩小了结论的适用范围。',
  ],
  IMPL: [
    '主干给出实际含义或建议。',
    '注意建议成立的前提条件。',
    '含义是从证据推出的判断，不等于已验证的结论。',
  ],
  FOCUS: [
    '本句是人工标注的基准句，右侧有逐项目标判断与证据。',
    '注意程度、让步、比较、否定或指代等限定结构如何改变语义范围。',
    '参考译文只用于理解对照，不能替代基于证据的诊断。',
  ],
  CONC: [
    '主干总结整段或全文的立场。',
    '注意作者在哪一点上保留判断、不下定论。',
    '结论需要回读前文证据才站得住。',
  ],
}

const FOLLOW_UPS: Record<string, string[]> = {
  LEAD: ['这一段接下来讨论的是哪个变量？', '引导句里的场景限定是什么？'],
  OPEN: ['研究背景改变了什么条件？', '时间跨度如何影响结论？'],
  FACT: ['研究发现的核心关系是什么？', '转折部分限定了什么条件？'],
  METHOD: ['这种方法解决了什么问题？', '方法本身有哪些局限？'],
  QUAL: ['哪个变量被赋予了更大权重？', '换一个地区，结论还会成立吗？'],
  IMPL: ['作者建议的前提条件是什么？', '这条建议适用于文中所有场景吗？'],
  CONC: ['作者在哪一点上保留了判断？', '这个结论依赖哪些前文证据？'],
  FOCUS: ['限定结构改变了哪一层语义？', '不看参考译文能自行还原主干吗？'],
}

export function offlineExplanationCount(): number {
  return READINGS.size
}

/** Build the same analysis as before, upgraded with a built-in full reading
 * when this sentence came from the 100 bundled passages. */
export function analysisWithOffline(
  sentenceId: string,
  sentenceText: string,
  contextBefore = '',
  contextAfter = '',
): SentenceAnalysis {
  const base = analyzeSentence(sentenceId, sentenceText, contextBefore, contextAfter)
  const reading = READINGS.get(sentenceId)
  if (!reading) return { ...base, source: 'local' }
  const skeleton = reading.skeleton
    ? {
        subject: reading.skeleton.subject,
        predicate: reading.skeleton.predicate,
        object: reading.skeleton.object,
        note: 'Built-in English clause skeleton from the original sentence.',
      }
    : base.skeleton
  return {
    ...base,
    source: 'bundled',
    skeleton,
    meaning: reading.meaning,
    layers: LAYERS[reading.category] ?? base.layers,
    followUps: FOLLOW_UPS[reading.category] ?? base.followUps,
  }
}
