import type {
  DiagnosticTarget,
  SentenceAnalysis,
  TargetCategory,
  TargetWeight,
  TransferTemplate,
} from './types'
import { fnv1a } from './hash'

/* ------------------------------------------------------------------ *
 * Offline teaching rule library.
 *
 * These rules are the DEFAULT (mock) provider's "knowledge". They are
 * deliberately conservative: a verdict of `incorrect` is only produced
 * when the learner's own words contain an explicit conflict pattern.
 * Missing detail => `partial` / `insufficient`, never `incorrect`.
 * No rule ever requires a grammar term (e.g. "定语从句").
 * ------------------------------------------------------------------ */

interface TargetSpec {
  key: string
  category: TargetCategory
  weight: TargetWeight
  span: RegExp
  spanFallback: string
  expectedMeaning: string
  supportedAlternatives: string[]
  possibleMisreadings: string[]
  accept: string[]
  conflict: string[]
  partial: string[]
  hintLevel1: string
  hintLevel2: string
  explanation: string
  transfer?: TransferTemplate
  ambiguous?: boolean
}

interface SentenceRule {
  id: string
  match: RegExp
  skeleton: (s: string) => SentenceAnalysis['skeleton']
  meaning: string
  layers: string[]
  followUps: string[]
  targets: TargetSpec[]
  ambiguity?: string
}

const SIMPLE_SKELETON = (subject: string, predicate: string, object: string, note: string) => () => ({
  subject, predicate, object, note,
})

/** Take a leading span of at most `max` chars, ending on a whole word.
 * Never cut a word in half — a fragment like "...earliest f" is not a real
 * source span and reads as broken text in the diagnostics table. */
function leadingSpan(sentence: string, max: number): string {
  if (sentence.length <= max) return sentence
  const cut = sentence.slice(0, max)
  const lastSpace = cut.lastIndexOf(' ')
  // Fall back to the full limit only when there is no word boundary at all.
  return lastSpace > 0 ? cut.slice(0, lastSpace).trimEnd() : cut.trimEnd()
}

/** Keep every originalSpan a genuine substring of the sentence (Validator checks this). */
function spanOf(sentence: string, pattern: RegExp, fallback: string): string {
  const m = sentence.match(pattern)
  if (m && m[0]) return m[0]
  if (fallback && sentence.includes(fallback)) return fallback
  return leadingSpan(sentence, 48)
}

/** Conservative chunking by punctuation; used when no rule-specific chunks exist. */
export function splitChunks(sentence: string): { text: string; role: string; meaning: string }[] {
  const byPunct = sentence
    .split(/(?<=[,;])\s+/)
    .map((p) => p.trim())
    .filter(Boolean)
  const parts: string[] = byPunct.length > 1 ? byPunct : []
  if (parts.length === 0) {
    const words = sentence.split(/\s+/)
    const size = 8
    for (let i = 0; i < words.length; i += size) parts.push(words.slice(i, i + size).join(' '))
  }
  return parts.map((text, i) => ({
    text,
    role: i === 0 ? '起始意群' : i === parts.length - 1 ? '收尾意群' : '中间意群',
    meaning: '',
  }))
}

const RULES: SentenceRule[] = [
  {
    id: 'extent-depends',
    match: /\bThe extent to which\b[\s\S]*\bdepends on\b/i,
    skeleton: SIMPLE_SKELETON(
      'The extent to which technology improves productivity（提升的程度）',
      'depends on',
      'how effectively employees use it（员工使用得有多有效）',
      '主语是一个「程度」名词短语，不是「技术」本身',
    ),
    meaning: '技术能在多大程度上提高生产率，取决于员工使用它有多有效。',
    layers: [
      '主干：The extent ... depends on ...（程度取决于……）',
      'The extent to which technology improves productivity：定语从句限定「哪一方面的程度」',
      'how effectively employees use it：介词 on 的宾语，问的是「有效程度」，不是「用什么方法」',
      'it 回指 technology',
    ],
    followUps: [
      '如果把 how effectively 换成 whether，句意会怎么变？',
      '原句有没有断言「技术一定提高生产率」？',
    ],
    targets: [
      {
        key: 'dependency-direction',
        category: '核心主谓',
        weight: 'core',
        span: /depends on how effectively[^\.]*|depends on[^\.]*/i,
        spanFallback: 'depends on',
        expectedMeaning: '提升的「程度」取决于员工使用的「有效程度」；方向不可倒置为因果。',
        supportedAlternatives: ['有多大改善要看用得多有效', '提升幅度由使用效率决定'],
        possibleMisreadings: ['倒因为果：生产率提高所以员工用得更有效', '只说「怎么使用」而丢掉「程度 / 有效性」'],
        accept: [
          '(程度|多大程度|幅度|有多大|多少).{0,24}(取决于|依赖于|决定)',
          '取决于.{0,24}(有效|有效性|多有效|有多有效|效率)',
          '(取决于|依赖于).{0,8}(员工|使用者).{0,8}(如何|怎么|怎样).{0,8}(有效|使用得)',
        ],
        conflict: [
          '(提高|提升|改善).{0,10}生产率.{0,14}(所以|因此|于是|从而)',
          '(所以|因此|于是|从而).{0,14}(更|更加)?(有效|更好地).{0,8}(用|使用)',
          '(决定|导致|造成).{0,10}(员工|使用者).{0,8}(更)?有效',
        ],
        partial: ['取决于.{0,24}(怎么|如何|怎样|方式|用法|使用技术)', '(取决于|依赖于).{0,16}(员工|人)'],
        hintLevel1: '大方向抓住了，但有一个决定句意的细节还没出现：原句谈的是「多大程度」，不是「是否」或「怎么做」。',
        hintLevel2: '注意 The extent to which = 「……的程度」；how effectively 问「有多有效」，不是「用什么方法」。试着把这两层都放进你的表述。',
        explanation:
          '主干是 The extent ... depends on ...。主语中心词是 extent（程度），technology improves productivity 只是限定「哪方面的程度」。宾语 how effectively employees use it 问的是有效程度。因此句意是「提升幅度取决于使用得多有效」，既不是因果倒置，也不等于「取决于怎么用」。',
        transfer: {
          sentence: 'The degree to which a policy reduces emissions depends on how consistently households adopt it.',
          meaning: '政策能在多大程度上减少排放，取决于家庭执行的持续程度。',
          keyPoint: '程度名词 + depends on + how/一致性：识别「程度取决于有效/持续程度」',
          accept: ['程度.{0,20}(取决于|依赖于)', '取决于.{0,20}(持续|一致|坚持)', '(多大|多少).{0,16}(减排|减少)'],
          conflict: ['(减排|减少).{0,12}(所以|因此).{0,12}(坚持|执行)', '是否.{0,8}减排'],
        },
      },
      {
        key: 'extent-scope',
        category: '语义程度与否定范围',
        weight: 'important',
        span: /The extent to which/i,
        spanFallback: 'The extent',
        expectedMeaning: '语义范围是「程度 / 幅度」，不是「是与否」。',
        supportedAlternatives: ['多大程度', '幅度', '有多少'],
        possibleMisreadings: ['把程度读成是否', '完全忽略程度限定'],
        accept: ['程度|多大(程度)?|有多大|多少|幅度|在多大'],
        conflict: [],
        partial: ['是否|会不会|能不能'],
        hintLevel1: '句首还有一个限定全句语义范围的结构，你的回答暂时没提到它。',
        hintLevel2: '看句首 The extent to which —— 它把命题从「是否发生」变成「发生的程度」。',
        explanation: 'The extent to which 限定的是程度范围，整句问「到什么程度」，不是「会不会」。',
        ambiguous: false,
      },
    ],
  },
  {
    id: 'concession',
    match: /^(Although|Though|Even though|While)\b/i,
    skeleton: SIMPLE_SKELETON(
      'understanding',
      'depends on',
      'critical evaluation',
      'Although 从句是让步背景，主句才是作者真正要说的判断',
    ),
    meaning: '虽然资源随处可见，但理解仍取决于批判性评价（资源丰富并不自动带来理解）。',
    layers: [
      'Although resources are widely available：让步状语从句，承认一个事实',
      'understanding depends on critical evaluation：主句，提出限制性判断',
      '前后是转折 / 让步关系，不是因果关系',
    ],
    followUps: ['把 Although 换成 Because，作者的立场会变吗？', '作者是否认为资源越多理解就越好？'],
    targets: [
      {
        key: 'concession-relation',
        category: '逻辑关系',
        weight: 'core',
        span: /^(Although|Though|Even though|While)[^,]+,/i,
        spanFallback: 'Although',
        expectedMeaning: '前后是让步转折：资源丰富不构成理解更好的原因。',
        supportedAlternatives: ['尽管资源丰富，理解仍要看……', '资源多不等于理解好'],
        possibleMisreadings: ['把让步读成因果：资源丰富所以理解更好'],
        accept: [
          '虽然|尽管|即便|固然',
          '(但|却|仍|还是).{0,12}(取决于|需要|靠|依赖)',
          '(并不|不).{0,8}(自动|必然|因此).{0,8}(更好|理解)',
        ],
        conflict: [
          '(因此|所以|于是|从而|因为).{0,14}(理解|自然|更好|容易)',
          '自然(就|会|更)?(好|理解|容易)',
        ],
        partial: ['资源.{0,12}(理解|评价)'],
        hintLevel1: '你把前后两个分句连成了顺向关系，但连接词表达的是让步/转折。',
        hintLevel2: 'Although A, B 表示「虽然 A，但 B 依然成立」；A 不是 B 的原因。请重新组织两个分句的关系。',
        explanation:
          'Although 引导让步状语从句，承认「资源容易获得」这一事实；主句用 depends on 提出真正的限制条件：理解要靠批判性评价。二者是转折，不是因果，作者并未说资源多理解就好。',
        transfer: {
          sentence: 'Although the dataset is large, the conclusion depends on how carefully the samples were selected.',
          meaning: '虽然数据集很大，但结论仍取决于样本筛选有多谨慎。',
          keyPoint: '让步 + 主句限制条件：不要把让步从句读成原因',
          accept: ['虽然|尽管|即便', '(但|仍|却).{0,12}(取决于|看)'],
          conflict: ['(因此|所以).{0,12}(结论|可靠|准确)', '数据.{0,8}(大|多).{0,8}(所以|因此)'],
        },
      },
      {
        key: 'main-dependency',
        category: '核心主谓',
        weight: 'important',
        span: /depends on[^.]*/i,
        spanFallback: 'depends on',
        expectedMeaning: '理解取决于批判性评价。',
        supportedAlternatives: ['要靠批判性评估', '需要自己评判'],
        possibleMisreadings: ['理解自动产生', '与评价无关'],
        accept: ['取决于|依赖于|靠|需要|要看'],
        conflict: ['(不需要|无关|自动|必然).{0,10}(评价|判断|理解)'],
        partial: [],
        hintLevel1: '主句里还有一个限定条件，检查一下它是否被表达出来了。',
        hintLevel2: '看主句的 depends on 后面接的是什么。',
        explanation: '主句主干是 understanding depends on critical evaluation，理解不是自动发生的。',
      },
    ],
  },
  {
    id: 'comparative-weight',
    match: /\bless\s+[\s\S]{1,80}?\s+than\b/i,
    skeleton: SIMPLE_SKELETON('Success', 'depends', 'less on speed / more on accuracy', 'less A than B 重新分配权重，B 更关键'),
    meaning: '成功与其说取决于速度，不如说更取决于准确性（两者权重不相等）。',
    layers: [
      '主干：Success depends ... on ...',
      'less on speed than on accuracy：比较结构，降低 speed 的权重、抬高 accuracy',
      '不是「两者同等重要」，也不是「速度更重要」',
    ],
    followUps: ['如果把 less 换成 more，结论会反转吗？', '原句有没有否定速度的作用？'],
    targets: [
      {
        key: 'comparative-direction',
        category: '逻辑关系',
        weight: 'core',
        span: /less\s+[^.]*?\s+than\s+[^.]*/i,
        spanFallback: 'less',
        expectedMeaning: '准确性比速度权重更高；不是同等重要。',
        supportedAlternatives: ['更看准确性', '准确性更关键', '与其说靠速度不如说靠准确'],
        possibleMisreadings: ['两者同等重要', '速度更重要'],
        accept: [
          '(相比|比起|相较于).{0,12}(速度|快).{0,12}(更|主要).{0,8}(准确|精确)',
          '(更|主要).{0,8}(取决于|依靠|靠|看).{0,8}(准确|精确)',
          '(准确|精确).{0,8}(更|主要|关键|权重)',
          '与其说.{0,12}(速度|快).{0,12}不如说',
        ],
        conflict: [
          '同等|一样(重要|取决于|程度)|两者.{0,8}(都|同样|持平|并重)',
          '(速度|快).{0,6}(比|相比).{0,10}(更|最)(重要|关键)',
        ],
        partial: ['(准确|速度).{0,10}(都|和|与)'],
        hintLevel1: '你把两个因素放成了相同权重，但句子里有一个专门用来重新分配权重的结构。',
        hintLevel2: 'less A than B 相当于「与其说靠 A，不如说靠 B」/「B 比 A 更关键」。请判断哪一端被抬高。',
        explanation:
          'less on speed than on accuracy 是比较结构，把权重从 speed 移向 accuracy。句子承认速度有作用，但明确说准确性更关键；它没有说两者同等，也没有否定速度。',
        transfer: {
          sentence: 'The quality of a conclusion depends less on the volume of data than on how carefully it is interpreted.',
          meaning: '结论的质量与其说取决于数据量，不如说取决于解读有多谨慎。',
          keyPoint: 'less A than B 的权重转移',
          accept: ['(相比|比起).{0,12}(数据|数量).{0,12}(更|不如说).{0,8}(解读|谨慎)', '(更|主要).{0,8}(取决于|看).{0,8}(解读|谨慎)'],
          conflict: ['同等|一样重要|两者.{0,6}(都|并重)', '数据.{0,6}(量|多).{0,6}(更|最)重要'],
        },
      },
      {
        key: 'main-verb',
        category: '核心主谓',
        weight: 'minor',
        span: /depends(?:\s+less)?\s+on/i,
        spanFallback: 'depends',
        expectedMeaning: '成功「取决于」某些条件。',
        supportedAlternatives: ['要看', '由……决定'],
        possibleMisreadings: ['成功与条件无关'],
        accept: ['取决于|依赖于|靠|要看|由.{0,6}决定'],
        conflict: [],
        partial: [],
        hintLevel1: '主干动词表达的是「依赖 / 取决于」，确认一下是否说到了。',
        hintLevel2: '看 depends on 这个搭配。',
        explanation: 'depends on 表示「取决于」，其后接的是条件而不是原因或结果。',
      },
    ],
  },
  {
    id: 'purpose-not-result',
    match: /\b(was|is|were|are|be)\s+designed\s+to\b|\b(aims?|intended|meant)\s+to\b/i,
    skeleton: SIMPLE_SKELETON('The system', 'was designed', 'to reduce costs（目的）', '不定式表目的，不表已完成的动作'),
    meaning: '这套系统的设计目的是降低成本；句子没有说成本已经降下来了。',
    layers: [
      '主语 + be designed：被动，说明设计意图',
      'to reduce costs：目的状语（不定式）',
      '全句没有结果 / 完成体的证据',
    ],
    followUps: ['要表达「成本确实下降了」，句子需要怎么改？', 'designed 与 has reduced 在时间性上差在哪？'],
    targets: [
      {
        key: 'purpose-vs-result',
        category: '语义程度与否定范围',
        weight: 'core',
        span: /\b(was|is|were|are)\s+designed\s+to\s+[^.]*/i,
        spanFallback: 'designed to',
        expectedMeaning: '这是设计目标，不是已经实现的结果。',
        supportedAlternatives: ['旨在降低', '用来降低成本', '目标是降本'],
        possibleMisreadings: ['把目的当结果：成本已经降低'],
        accept: ['旨在|目的是|目标(是|在)|为了|用来|被设计来|意图是|以(降低|减少)|设计.{0,8}(目的|目标|用来)'],
        conflict: [
          '已经(降低|减少|下降|省下|实现)',
          '(降低|减少|节省)了.{0,6}(成本|费用|开支)',
          '成本.{0,8}(已经|已|早已).{0,6}(下降|降低|减少)',
          '实现(了)?.{0,8}(降低|降本|节省)',
        ],
        partial: ['(降低|减少).{0,6}(成本|费用|开支)', '成本.{0,8}(降低|减少)'],
        hintLevel1: '你把「设计意图」读成了「已经发生的事实」；句子里没有给出结果完成的证据。',
        hintLevel2: 'be designed to do 里的不定式表示目的。对比 The system reduced costs（结果）。请区分「打算做什么」和「已经做成什么」。',
        explanation:
          'was designed to reduce costs 中，to reduce costs 是目的状语，说明系统设计想达成什么；谓语是被动的设计行为，不是 reduce 的完成体。因此不能推出成本已经下降。',
        transfer: {
          sentence: 'The survey was designed to measure long-term retention rather than immediate recall.',
          meaning: '这项调查旨在测量长期记忆保持，而非即时回忆；句子未说明测量结果。',
          keyPoint: 'be designed to 的目的 / 结果区分',
          accept: ['旨在|目的是|为了|用来|目标', '(而非|而不是).{0,10}(即时|短期)'],
          conflict: ['已经(测|测量|证明)', '(测出|证明了).{0,8}(保持|记忆)'],
        },
      },
    ],
  },
  {
    id: 'partial-negation',
    match: /\bnot always\b|\bnot necessarily\b|\bnot entirely\b/i,
    skeleton: SIMPLE_SKELETON('The information students encounter', 'is', 'not always reliable', '部分否定：并非全部'),
    meaning: '学生接触到的信息未必可靠（并非全部可靠），也不是说全都不可靠。',
    layers: [
      '主语：The information (that) students encounter，定语从句限定信息来源',
      '系表结构：is not always reliable',
      'not always 是部分否定，范围是「并非总是 / 未必」',
    ],
    followUps: ['not always 和 never 的否定范围有何不同？', '能否从这句推出「大多数信息都不可靠」？'],
    targets: [
      {
        key: 'negation-scope',
        category: '语义程度与否定范围',
        weight: 'core',
        span: /not (always|necessarily|entirely)\s+[^.]*/i,
        spanFallback: 'not always',
        expectedMeaning: '部分否定：未必可靠 / 并非总是可靠，不是全盘否定。',
        supportedAlternatives: ['不一定可信', '并非都可靠', '有时不可靠'],
        possibleMisreadings: ['全都不可靠', '完全可靠'],
        accept: ['未必|不一定|并非(总是|都|全部)|不总是|有时候不|并非.{0,6}可靠|不全'],
        conflict: [
          '全都.{0,6}(不|不可靠|不可信)',
          '完全(不|没).{0,4}(可靠|可信)',
          '都不(可靠|可信)',
          '没有任何.{0,6}(可靠|可信|信息)',
          '全部.{0,4}可靠',
        ],
        partial: [],
        hintLevel1: '注意否定的范围：这里不是一个全盘否定。',
        hintLevel2: 'not always = 「并非总是 / 未必」；对比 never（从不）与 not reliable（不可靠）。',
        explanation:
          'not always reliable 是部分否定，意为「未必可靠 / 并非总是可靠」。它既没有说全部不可靠，也没有说全部可靠。回答只要表达出「不一定 / 未必」即可，不需要说出「部分否定」这个术语。',
        transfer: {
          sentence: 'Findings based on small samples are not necessarily generalisable.',
          meaning: '基于小样本的发现未必可以推广。',
          keyPoint: 'not necessarily 的部分否定范围',
          accept: ['未必|不一定|并非.{0,6}(都|总是)|不必然'],
          conflict: ['一定(不能|无法).{0,6}推广', '全都.{0,4}(不|无法)推广'],
        },
      },
      {
        key: 'relative-clause',
        category: '修饰与从句功能',
        weight: 'important',
        span: /\binformation\s+[a-z]+\s+[a-z]+/i,
        spanFallback: 'information',
        expectedMeaning: 'students encounter 限定「学生接触到的那类信息」。用不用语法术语都不影响判断。',
        supportedAlternatives: ['学生看到的信息', '学生获取的信息'],
        possibleMisreadings: ['把信息来源换成教师 / 研究者'],
        accept: ['学生.{0,8}(接触|遇到|看到|读到|获取|使用)|接触.{0,6}的.{0,4}信息|学生.{0,6}的.{0,4}信息'],
        conflict: ['(老师|教师|研究者|研究人员).{0,8}(接触|提供)的'],
        partial: [],
        hintLevel1: '主语里还有一层限定，说明是「谁接触到的信息」。',
        hintLevel2: 'information 后面紧跟的 students encounter 是省略了关系词的限定成分。',
        explanation:
          'students encounter 是修饰 information 的限定成分（可理解为省略 that 的定语从句）。只要理解成「学生接触到的信息」就是正确的，完全不必说出「定语从句」这类术语。',
      },
    ],
  },
  {
    id: 'whether-condition',
    match: /\bdepends on whether\b|\bwhether\b/i,
    skeleton: SIMPLE_SKELETON('The decision', 'depends on', 'whether the evidence is sufficient', 'whether 引导条件性宾语'),
    meaning: '这个决定取决于证据是否充足。',
    layers: [
      '主干：The decision depends on ...',
      'whether the evidence is sufficient：作介词宾语，表示一个待判定的条件',
      '全句没有断言证据已经充足或不充足',
    ],
    followUps: ['句子有没有告诉我们证据到底够不够？', '把 whether 换成 because 会改变什么？'],
    targets: [
      {
        key: 'condition-dependency',
        category: '逻辑关系',
        weight: 'core',
        span: /depends on whether[^.]*/i,
        spanFallback: 'depends on',
        expectedMeaning: '决定取决于「证据是否充足」这个待定条件；句子未给出结论。',
        supportedAlternatives: ['看证据够不够', '由证据是否充分决定'],
        possibleMisreadings: ['认定证据已经充足', '认为与证据无关'],
        accept: [
          '取决于.{0,20}(是否|充足|足够|充分|够不够)',
          '证据.{0,8}(是否|够不够|充分|充足)',
          '(看|由).{0,10}证据.{0,8}(决定|是否|够)',
        ],
        conflict: ['无论|不管|与证据无关|证据.{0,6}(已经|已)(充足|确定)|一定(充足|够)'],
        partial: ['(决定|决策).{0,8}(证据|信息)'],
        hintLevel1: '主干抓住了，但「取决于什么」这部分还是一个开放条件，检查一下是否说清。',
        hintLevel2: 'whether 表示「是否」，是尚未判定的条件；句子并没有说证据已经够或不够。',
        explanation:
          'depends on whether ... 中 whether 引导的是一个待判定条件。句意是「决定取决于证据是否充足」，既未断言证据充足，也未断言不足。用户不需要说出「名词性从句」「宾语从句」等术语。',
        transfer: {
          sentence: 'Whether the trial continues depends on how participants respond to the first phase.',
          meaning: '试验是否继续，取决于参与者对第一阶段的反应。',
          keyPoint: 'whether / 取决于 的条件依赖',
          accept: ['(是否|能不能).{0,10}(继续|持续)', '取决于.{0,16}(反应|反馈|参与)'],
          conflict: ['一定(继续|停止)', '与.{0,6}反应无关'],
        },
      },
      {
        key: 'chunking',
        category: '意群',
        weight: 'minor',
        span: /depends on whether[^.]*/i,
        spanFallback: 'depends on',
        expectedMeaning: '按「决定 / 取决于 / 证据是否充足」切意群即可，切法不唯一。',
        supportedAlternatives: ['看证据充不充分'],
        possibleMisreadings: [],
        accept: ['取决于|证据|充足|充分|够不够'],
        conflict: [],
        partial: [],
        hintLevel1: '试着把长句切成几个意群再理解。',
        hintLevel2: '以 depends on 为界，前面是「谁」，后面是「取决于什么」。',
        explanation: '意群切分不唯一，只要没有把主干关系读反都属于合理简化。',
      },
    ],
  },
  {
    id: 'parenthesis-negation',
    match: /,\s*introduced\b[^,]*,|\bhas not yet\b|\bhave not yet\b/i,
    skeleton: SIMPLE_SKELETON('The policy', 'has not yet produced', 'measurable results', '插入语补充时间背景，谓语是否定完成体'),
    meaning: '去年出台的政策，到目前为止尚未产生可测量的结果。',
    layers: [
      '主语：The policy',
      ', introduced last year,：插入语，补充政策出台时间，不是主句谓语',
      'has not yet produced measurable results：否定 + yet，表示「到此刻仍未」',
    ],
    followUps: ['把 not yet 去掉，时间含义怎么变？', '插入语去掉后主句还成立吗？'],
    targets: [
      {
        key: 'negation-time',
        category: '语义程度与否定范围',
        weight: 'core',
        span: /has not yet[^.]*|have not yet[^.]*/i,
        spanFallback: 'not yet',
        expectedMeaning: '到目前为止尚未产生可测量结果（否定 + 时间）。',
        supportedAlternatives: ['还没有看到成效', '至今未产生结果'],
        possibleMisreadings: ['把「尚未」读成「已经」'],
        accept: ['尚未|还没有|仍未|至今.{0,8}(没有|未)|未(产生|取得)|没有.{0,8}(产生|结果|成效)|没(有)?.{0,4}出结果'],
        conflict: [
          '已经(产生|取得|有|出现).{0,8}(结果|成效|效果)',
          '去年.{0,8}(已|已经|就).{0,6}(产生|取得|有)',
          // Note: "产生可测量结果" alone is NOT a conflict - the negation check above decides.
        ],
        partial: ['去年.{0,12}(结果|成效)'],
        hintLevel1: '谓语的时间与否定方向需要再看一眼：句子说的是「到此刻怎样」。',
        hintLevel2: 'has not yet produced = 「到现在还没有产生」。注意 not 与 yet 共同限定的是未完成。',
        explanation:
          'has not yet produced 是否定完成体，yet 强调「截至当前仍未」。插入语 introduced last year 只给出政策出台时间，不表示结果已经出现。',
        transfer: {
          sentence: 'The method, adopted in 2019, has not yet been validated outside the laboratory.',
          meaning: '该方法 2019 年被采用，但至今尚未在实验室之外得到验证。',
          keyPoint: '插入语 + not yet 的时间/否定范围',
          accept: ['尚未|还没有|仍未|至今.{0,6}未'],
          conflict: ['已经(得到|被)?验证', '(2019|当年).{0,6}已.{0,4}验证'],
        },
      },
      {
        key: 'parenthesis-function',
        category: '修饰与从句功能',
        weight: 'minor',
        span: /,\s*introduced[^,]*,/i,
        spanFallback: 'introduced',
        expectedMeaning: '插入语补充「去年出台」这一背景信息。',
        supportedAlternatives: ['去年推出的政策', '去年实施的那项政策'],
        possibleMisreadings: ['把插入语当主句谓语'],
        accept: ['去年.{0,8}(出台|推出|实施|颁布|引入|发布|采用)|出台.{0,6}的.{0,4}政策|去年.{0,6}的.{0,4}政策'],
        conflict: [],
        partial: [],
        hintLevel1: '句子中间有一块补充信息，它不属于主干。',
        hintLevel2: '两个逗号之间的成分是插入语，去掉它主句依然完整。',
        explanation: ', introduced last year, 是插入语，补充政策出台时间。用户不必说出「过去分词短语」等术语。',
      },
    ],
  },
]

/** Pronoun ambiguity rule - deliberately returns `disputed`, never a hard error. */
const PRONOUN_RULE = {
  id: 'pronoun-reference',
  match: /\b(them|these|those)\b/i,
}

/** Small academic word map used only by the conservative generic fallback. */
const WORD_MAP: [RegExp, string][] = [
  [/\btechnolog(y|ies)\b/i, '技术'], [/\bproductivity\b/i, '生产率'], [/\bemployees?\b/i, '员工'],
  [/\bresources?\b/i, '资源'], [/\bunderstanding\b/i, '理解'], [/\bevaluation\b/i, '评价'],
  [/\bsuccess\b/i, '成功'], [/\bspeed\b/i, '速度'], [/\baccuracy\b/i, '准确'],
  [/\bsystem\b/i, '系统'], [/\bcosts?\b/i, '成本'], [/\binformation\b/i, '信息'],
  [/\bstudents?\b/i, '学生'], [/\breliable\b/i, '可靠'], [/\bdecision\b/i, '决定'],
  [/\bevidence\b/i, '证据'], [/\bsufficient\b/i, '充足'], [/\bpolicy\b/i, '政策'],
  [/\bresults?\b/i, '结果'], [/\bmeasures?\b/i, '测量'], [/\bdata\b/i, '数据'],
  [/\bresearch(ers?)?\b/i, '研究'], [/\bclimate\b/i, '气候'], [/\bemissions?\b/i, '排放'],
  [/\bbenefits?\b/i, '好处'], [/\brisks?\b/i, '风险'], [/\bincrease\b/i, '增加'],
  [/\breduce\b/i, '降低'], [/\bimprove\b/i, '改善'], [/\bdepend(s|ent)?\b/i, '取决于'],
]

function genericTargets(sentenceId: string, sentence: string): DiagnosticTarget[] {
  const matchedWords = WORD_MAP.filter(([re]) => re.test(sentence)).map(([, zh]) => zh)
  const anchors = matchedWords.slice(0, 6)
  const accept = anchors.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const common = {
    sentenceId,
    supportedAlternatives: ['合理意译', '用自己的话说出大意'],
    possibleMisreadings: ['把主干关系读反', '把修饰成分当成主干'],
    hintLevel1: '先确认你抓住的是句子的主干关系，再看修饰成分。',
    hintLevel2: '试着把长句按意群切开，找出「谁 + 做什么 / 是什么 + 受什么限制」。',
    explanation:
      '离线规则对这一句只提供保守的结构提示，不提供权威参考译文。请把文章当作不可信纯文本阅读；如需完整解析，可连接已验证的模型 Provider。',
  }
  return [
    {
      ...common,
      id: `${sentenceId}:t:generic-core`,
      category: '核心主谓',
      weight: 'core',
      originalSpan: sentence.length <= 200 ? sentence : leadingSpan(sentence, 60),
      expectedMeaning: '抓住句子主干关系（谁 + 做什么 / 是什么），并保留否定与比较等关键限定。',
      rules: {
        accept,
        conflict: [],
        partial: [],
      },
    },
    {
      ...common,
      id: `${sentenceId}:t:generic-chunk`,
      category: '意群',
      weight: 'minor',
      originalSpan: sentence.length <= 200 ? sentence : leadingSpan(sentence, 48),
      expectedMeaning: '按意群理解，切分方式不唯一，合理简化不算错。',
      rules: { accept, conflict: [], partial: [] },
    },
  ]
}

/** Build the full analysis for a sentence. Pure function, no model call. */
export function analyzeSentence(
  sentenceId: string,
  sentenceText: string,
  contextBefore = '',
  contextAfter = '',
): SentenceAnalysis {
  const rule = RULES.find((r) => r.match.test(sentenceText))
  const targets: DiagnosticTarget[] = rule
    ? rule.targets.map((spec) => ({
        id: `${sentenceId}:t:${spec.key}`,
        sentenceId,
        category: spec.category,
        weight: spec.weight,
        originalSpan: spanOf(sentenceText, spec.span, spec.spanFallback),
        expectedMeaning: spec.expectedMeaning,
        supportedAlternatives: spec.supportedAlternatives,
        possibleMisreadings: spec.possibleMisreadings,
        hintLevel1: spec.hintLevel1,
        hintLevel2: spec.hintLevel2,
        explanation: spec.explanation,
        transferTemplate: spec.transfer,
        rules: {
          accept: spec.accept,
          conflict: spec.conflict,
          partial: spec.partial,
        },
      }))
    : genericTargets(sentenceId, sentenceText)

  const ambiguousPronoun = PRONOUN_RULE.match.test(sentenceText)
  let ambiguity: string | undefined
  if (ambiguousPronoun) {
    const pluralCandidates = (sentenceText.match(/\b[a-z]+s\b/gi) ?? []).length
    if (pluralCandidates >= 2) {
      ambiguity =
        '本句含复数代词（them / these / those），其指代可能依赖更长的上下文。系统不会仅凭一个名词猜测就判定为错误；若有不同解读，可标记为「有争议」并复核。'
      targets.push({
        id: `${sentenceId}:t:pronoun`,
        sentenceId,
        category: '指代',
        weight: 'minor',
        originalSpan: (sentenceText.match(/\b(them|these|those)\b/i) ?? ['them'])[0],
        expectedMeaning: '代词指代需结合更长上下文判断，存在多种合理读法。',
        supportedAlternatives: ['指代前文的复数对象', '指代更上文的另一组对象'],
        possibleMisreadings: ['在缺少上下文时强行指定唯一指代'],
        hintLevel1: '这句里有一个代词，确认它指的是前面哪一组对象。',
        hintLevel2: '往上一两句找复数名词候选；如果仍不唯一，就保留争议而不要硬选。',
        explanation: '缺少足够上下文时，指代允许争议，不写入长期能力负面记录。',
        ambiguous: true,
        rules: { accept: [], conflict: [], partial: [] },
      })
    }
  }

  const skeleton = rule
    ? rule.skeleton(sentenceText)
    : {
        subject: sentenceText.trim().split(/\s+/).slice(0, 4).join(' '),
        predicate: '（离线规则未标注谓语）',
        object: '',
        note: '该句未命中内置句式规则，仅提供保守结构提示，不代表模型解析结果。',
      }

  const phrases = WORD_MAP.filter(([re]) => re.test(sentenceText))
    .slice(0, 6)
    .map(([re, zh]) => ({
      text: (sentenceText.match(re) ?? [''])[0],
      meaning: `语境义参考：${zh}`,
    }))
    .filter((p) => p.text.length > 0)
    .filter((p, i, arr) => arr.findIndex((x) => x.text === p.text) === i)

  void contextBefore
  void contextAfter

  return {
    sentenceId,
    skeleton,
    chunks: splitChunks(sentenceText),
    phrases,
    meaning: rule
      ? rule.meaning
      : '（离线规则未给出权威参考译文。连接已验证的模型 Provider 后可获得完整语义解析。）',
    layers: rule
      ? rule.layers
      : ['离线规则仅按标点与常见搭配切分意群', '未对句法成分作权威性判断', '合理简化与意译均不视为错误'],
    followUps: rule
      ? rule.followUps
      : ['这句话的主干是什么？', '有没有否定、比较或让步结构改变了语义范围？'],
    targets,
    ambiguity: ambiguity ?? rule?.ambiguity,
  }
}

export function ruleIdFor(sentenceText: string): string {
  return RULES.find((r) => r.match.test(sentenceText))?.id ?? 'generic'
}

export function targetFingerprint(target: DiagnosticTarget): string {
  return fnv1a(`${target.category}|${target.originalSpan}|${target.expectedMeaning}`).toString(36)
}
