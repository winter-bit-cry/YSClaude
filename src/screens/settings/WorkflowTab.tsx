import { useMemo, useRef, useState } from 'react';
import { Alert, Modal, PanResponder, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import Svg, { Line } from 'react-native-svg';
import { Plus, Play, Trash2, X } from 'lucide-react-native';
import { useSettingsPageColors } from '../../theme/colors';
import { useWorkflowStore } from '../../stores/workflows';
import { useSettingsStore } from '../../stores/settings';
import type { WorkflowNodeType } from '../../types/workflow';
import { WORKFLOW_TOOL_NAMES } from '../../services/workflowToolCatalog';
import { runWorkflow } from '../../services/workflowRunner';
import { syncWorkflowKeepAlive, syncWorkflowSchedule } from '../../services/workflowScheduler';
import { mcpRemoteTool } from '../../services/toolModules/mcpRemote';

type Props = { showToast: (message: string) => void; keyboardBottomInset: number };
const NODE_W = 230;
const NODE_H = 126;

export function WorkflowTab({ showToast, keyboardBottomInset }: Props) {
  const colors = useSettingsPageColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const workflows = useWorkflowStore((state) => state.workflows);
  const mcpToolConfig = useSettingsStore((state) => state.mcpToolConfig);
  const availableToolNames = useMemo(() => [...WORKFLOW_TOOL_NAMES, ...mcpRemoteTool.getDefinitions({ memoryVault: false, webSearch: false, mcpTools: mcpToolConfig }).map((tool) => tool.function.name)], [mcpToolConfig]);
  const actions = useWorkflowStore();
  const [selectedId, setSelectedId] = useState<string | null>(workflows[0]?.id || null);
  const [toolPicker, setToolPicker] = useState(false);
  const [toolPickerAgentId, setToolPickerAgentId] = useState<string | null>(null);
  const [linkFrom, setLinkFrom] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const workflow = workflows.find((item) => item.id === selectedId) || null;

  const addModule = (type: WorkflowNodeType, toolName?: string) => {
    if (!workflow) return;
    const count = workflow.nodes.length;
    const defaults = { timer: { intervalMinutes: 60 }, trigger: { checkIntervalMinutes: 1, code: 'return true;' }, agent: { prompt: '执行这一步 AI 任务。', toolNames: [], aiDecidesPush: true }, tool: { toolName }, notify: {} };
    const titles = { timer: '定时触发器', trigger: '代码触发器', agent: 'AI 任务', tool: toolName || '工具', notify: '发送通知' };
    actions.addNode(workflow.id, { type, title: titles[type], x: 80, y: 30 + count * 160, config: defaults[type] });
  };

  const toggleEnabled = async (enabled: boolean) => {
    if (!workflow) return;
    const nextRunAt = await syncWorkflowSchedule({ ...workflow, enabled }).catch(() => undefined);
    actions.updateWorkflow(workflow.id, { enabled, nextRunAt });
    await syncWorkflowKeepAlive(workflows.some((item) => item.id === workflow.id ? enabled : item.enabled)).catch(() => undefined);
    showToast(enabled ? '工作流已启用' : '工作流已停用');
  };

  const test = async () => {
    if (!workflow || running) return;
    setRunning(true);
    try { await runWorkflow(workflow.id, { manual: true }); showToast('测试执行完成'); }
    catch (error: any) { Alert.alert('执行失败', error?.message || '未知错误'); }
    finally { setRunning(false); }
  };

  if (!workflow) return <View style={styles.empty}><Text style={styles.emptyTitle}>还没有工作流</Text><Text style={styles.hint}>创建后可添加模块、拖拽布局并连接执行顺序。</Text><Pressable style={styles.primaryButton} onPress={() => setSelectedId(actions.createWorkflow())}><Plus size={17} color="#fff"/><Text style={styles.primaryText}>新建工作流</Text></Pressable></View>;

  return <View style={styles.root}>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.workflowStrip} contentContainerStyle={styles.workflowStripContent}>
      {workflows.map((item) => <Pressable key={item.id} style={[styles.workflowChip, item.id === workflow.id && styles.workflowChipActive]} onPress={() => setSelectedId(item.id)}><Text style={[styles.workflowChipText, item.id === workflow.id && { color: colors.primary }]}>{item.name}</Text></Pressable>)}
      <Pressable style={styles.addChip} onPress={() => setSelectedId(actions.createWorkflow())}><Plus size={16} color={colors.primary}/></Pressable>
    </ScrollView>
    <View style={styles.toolbar}>
      <TextInput style={styles.nameInput} value={workflow.name} onChangeText={(name) => actions.updateWorkflow(workflow.id, { name })}/>
      <Switch value={workflow.enabled} onValueChange={toggleEnabled}/>
      <Pressable style={styles.testButton} onPress={test} disabled={running}><Play size={16} color="#fff" fill="#fff"/><Text style={styles.testText}>{running ? '运行中' : '测试'}</Text></Pressable>
      <Pressable onPress={() => Alert.alert('删除工作流', '确定删除此工作流？', [{ text: '取消' }, { text: '删除', style: 'destructive', onPress: () => { syncWorkflowSchedule({ ...workflow, enabled: false }).catch(() => undefined); actions.deleteWorkflow(workflow.id); setSelectedId(null); } }])}><Trash2 size={20} color={colors.danger}/></Pressable>
    </View>
    <ScrollView horizontal style={styles.palette} contentContainerStyle={styles.paletteContent} keyboardShouldPersistTaps="handled">
      <Pressable style={styles.moduleButton} onPress={() => addModule('trigger')}><Text style={styles.moduleText}>＋ 代码触发器</Text></Pressable>
      <Pressable style={styles.moduleButton} onPress={() => addModule('agent')}><Text style={styles.moduleText}>＋ AI 任务</Text></Pressable>
      <Pressable style={styles.moduleButton} onPress={() => addModule('notify')}><Text style={styles.moduleText}>＋ 通知</Text></Pressable>
      {linkFrom && <Text style={styles.linkHint}>请选择另一模块完成连线</Text>}
    </ScrollView>
    <Text style={styles.codeHelp}>代码返回 true 时执行。可用：ctx.weekday（周日=0）、hour、minute、foregroundPackage、foregroundChanged、lastRunAt。</Text>
    <ScrollView style={styles.canvasScroll} contentContainerStyle={{ minHeight: Math.max(700, ...workflow.nodes.map((node) => node.y + 190)), paddingBottom: keyboardBottomInset }}><View style={styles.canvas}>
      <Svg style={StyleSheet.absoluteFill} width="100%" height="100%" pointerEvents="none">{workflow.edges.map((edge) => { const from = workflow.nodes.find((n) => n.id === edge.from); const to = workflow.nodes.find((n) => n.id === edge.to); return from && to ? <Line key={edge.id} x1={from.x + NODE_W / 2} y1={from.y + NODE_H} x2={to.x + NODE_W / 2} y2={to.y} stroke={colors.primary} strokeWidth={2.5}/> : null; })}</Svg>
      {workflow.nodes.map((node) => <CanvasNode key={node.id} node={node} selectedLink={linkFrom === node.id} onMove={(x: number, y: number) => actions.updateNode(workflow.id, node.id, { x, y })} onDelete={() => actions.deleteNode(workflow.id, node.id)} onConnect={() => { if (linkFrom && linkFrom !== node.id) { actions.addEdge(workflow.id, linkFrom, node.id); setLinkFrom(null); } else setLinkFrom(linkFrom === node.id ? null : node.id); }} onConfig={(config: any) => actions.updateNode(workflow.id, node.id, { config })} onPickTools={() => { setToolPickerAgentId(node.id); setToolPicker(true); }} styles={styles} colors={colors}/>) }
    </View></ScrollView>
    <Modal visible={toolPicker} transparent animationType="fade" onRequestClose={() => setToolPicker(false)}><View style={styles.modalBackdrop}><View style={styles.toolModal}><View style={styles.modalHeader}><Text style={styles.modalTitle}>选择此 AI 可使用的工具</Text><Pressable onPress={() => setToolPicker(false)}><X color={colors.text}/></Pressable></View><ScrollView>{availableToolNames.map((name) => { const agent = workflow.nodes.find((node) => node.id === toolPickerAgentId); const selected = Array.isArray(agent?.config.toolNames) && agent.config.toolNames.includes(name); return <Pressable key={name} style={[styles.toolRow, selected && styles.toolRowSelected]} onPress={() => { if (!agent) return; const current = Array.isArray(agent.config.toolNames) ? agent.config.toolNames : []; const toolNames = selected ? current.filter((item: string) => item !== name) : [...current, name]; actions.updateNode(workflow.id, agent.id, { config: { ...agent.config, toolNames } }); }}><Text style={[styles.toolName, selected && { color: colors.primary }]}>{selected ? '✓ ' : '＋ '}{name}</Text></Pressable>; })}</ScrollView></View></View></Modal>
  </View>;
}

function CanvasNode({ node, selectedLink, onMove, onDelete, onConnect, onConfig, onPickTools, styles, colors }: any) {
  const origin = useRef({ x: node.x, y: node.y });
  const pan = useMemo(() => PanResponder.create({ onStartShouldSetPanResponder: () => true, onPanResponderGrant: () => { origin.current = { x: node.x, y: node.y }; }, onPanResponderMove: (_, gesture) => onMove(Math.max(0, origin.current.x + gesture.dx), Math.max(0, origin.current.y + gesture.dy)) }), [node.x, node.y, onMove]);
  return <View style={[styles.node, { left: node.x, top: node.y }, selectedLink && styles.nodeLinking]}>
    <View style={styles.nodeHeader} {...pan.panHandlers}><Text numberOfLines={1} style={styles.nodeTitle}>{node.title}</Text><Pressable onPress={onDelete}><X size={15} color={colors.textSecondary}/></Pressable></View>
    {node.type === 'timer' && <TextInput keyboardType="number-pad" style={styles.nodeInput} value={String(node.config.intervalMinutes || '')} onChangeText={(value) => onConfig({ ...node.config, intervalMinutes: Number(value) || 1 })} placeholder="分钟"/>}
    {node.type === 'trigger' && <><TextInput keyboardType="number-pad" style={styles.nodeInput} value={String(node.config.checkIntervalMinutes || '')} onChangeText={(value) => onConfig({ ...node.config, checkIntervalMinutes: Number(value) || 1 })} placeholder="检查间隔（分钟）"/><TextInput multiline style={[styles.nodeInput, styles.codeInput]} value={node.config.code || ''} onChangeText={(code) => onConfig({ ...node.config, code })} placeholder="return ctx.hour === 8;"/></>}
    {node.type === 'agent' && <><TextInput multiline style={[styles.nodeInput, styles.promptInput]} value={node.config.prompt || ''} onChangeText={(prompt) => onConfig({ ...node.config, prompt })}/><Pressable style={styles.agentToolsButton} onPress={onPickTools}><Text style={styles.agentToolsText}>工具 · {Array.isArray(node.config.toolNames) ? node.config.toolNames.length : 0} 个</Text></Pressable><Text style={styles.agentToolsPreview} numberOfLines={1}>{Array.isArray(node.config.toolNames) && node.config.toolNames.length ? node.config.toolNames.join('、') : '未指定工具'}</Text><View style={styles.deliveryDecisionRow}><View style={styles.deliveryDecisionText}><Text style={styles.deliveryDecisionTitle}>由 AI 判断是否推送</Text><Text style={styles.deliveryDecisionHint}>推送消息 / 静默活动卡片</Text></View><Switch value={node.config.aiDecidesPush === true} onValueChange={(aiDecidesPush) => onConfig({ ...node.config, aiDecidesPush })} /></View></>}
    {node.type === 'tool' && <Text style={styles.nodeDetail} numberOfLines={2}>{node.config.toolName}</Text>}
    {node.type === 'notify' && <Text style={styles.nodeDetail}>将 AI 回复发送到通知</Text>}
    <Pressable style={styles.port} onPress={onConnect}><View style={styles.portDot}/><Text style={styles.portText}>{selectedLink ? '取消' : '连线'}</Text></Pressable>
  </View>;
}

function makeStyles(colors: any) { return StyleSheet.create({
  root:{flex:1},empty:{flex:1,alignItems:'center',justifyContent:'center',padding:30,gap:12},emptyTitle:{fontSize:20,fontWeight:'700',color:colors.text},hint:{color:colors.textSecondary,textAlign:'center'},primaryButton:{flexDirection:'row',gap:7,backgroundColor:colors.primary,paddingHorizontal:18,paddingVertical:11,borderRadius:9},primaryText:{color:'#fff',fontWeight:'700'},workflowStrip:{flexGrow:0},workflowStripContent:{paddingHorizontal:16,paddingVertical:8,gap:8},workflowChip:{paddingHorizontal:13,paddingVertical:8,borderRadius:9,backgroundColor:colors.inputBackground,borderWidth:1,borderColor:colors.border},workflowChipActive:{borderColor:colors.primary,backgroundColor:colors.primaryLight},workflowChipText:{color:colors.textSecondary,fontWeight:'600'},addChip:{width:38,alignItems:'center',justifyContent:'center',borderRadius:9,borderWidth:1,borderColor:colors.border},toolbar:{flexDirection:'row',alignItems:'center',gap:10,paddingHorizontal:16,paddingVertical:8},nameInput:{flex:1,minWidth:100,color:colors.text,fontSize:17,fontWeight:'700',borderBottomWidth:1,borderColor:colors.border,paddingVertical:5},testButton:{flexDirection:'row',alignItems:'center',gap:5,backgroundColor:colors.primary,borderRadius:8,paddingHorizontal:12,paddingVertical:8},testText:{color:'#fff',fontWeight:'700'},palette:{flexGrow:0},paletteContent:{paddingHorizontal:16,paddingVertical:8,gap:8,alignItems:'center'},moduleButton:{backgroundColor:colors.inputBackground,borderWidth:1,borderColor:colors.border,borderRadius:8,paddingHorizontal:12,paddingVertical:8},moduleText:{color:colors.text,fontWeight:'600'},linkHint:{color:colors.primary,fontSize:12},codeHelp:{paddingHorizontal:16,paddingBottom:7,color:colors.textTertiary,fontSize:10,lineHeight:14},canvasScroll:{flex:1,marginTop:4},canvas:{flex:1,minHeight:700,backgroundColor:colors.surfaceHover},node:{position:'absolute',width:NODE_W,minHeight:NODE_H,borderRadius:10,borderWidth:1.5,borderColor:colors.border,backgroundColor:colors.inputBackground,padding:9,elevation:3},nodeLinking:{borderColor:colors.primary,borderWidth:2},nodeHeader:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',paddingBottom:7},nodeTitle:{flex:1,fontSize:13,fontWeight:'800',color:colors.text},nodeInput:{borderWidth:1,borderColor:colors.border,borderRadius:6,paddingHorizontal:7,paddingVertical:4,color:colors.text,fontSize:12,backgroundColor:colors.background,marginBottom:5},promptInput:{height:42,textAlignVertical:'top'},codeInput:{height:55,textAlignVertical:'top',fontFamily:'monospace'},nodeDetail:{fontSize:11,color:colors.textSecondary,minHeight:36},agentToolsButton:{alignSelf:'flex-start',borderRadius:6,backgroundColor:colors.primaryLight,paddingHorizontal:8,paddingVertical:4},agentToolsText:{color:colors.primary,fontSize:11,fontWeight:'700'},agentToolsPreview:{fontSize:9,color:colors.textTertiary,marginTop:4},deliveryDecisionRow:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',marginTop:6,paddingTop:5,borderTopWidth:StyleSheet.hairlineWidth,borderColor:colors.border},deliveryDecisionText:{flex:1},deliveryDecisionTitle:{fontSize:10,fontWeight:'700',color:colors.text},deliveryDecisionHint:{fontSize:8,color:colors.textTertiary},port:{position:'absolute',bottom:-25,left:NODE_W/2-18,alignItems:'center'},portDot:{width:14,height:14,borderRadius:7,backgroundColor:colors.primary,borderWidth:2,borderColor:colors.inputBackground},portText:{fontSize:9,color:colors.primary,marginTop:2},modalBackdrop:{flex:1,backgroundColor:'rgba(0,0,0,.45)',justifyContent:'center',padding:22},toolModal:{maxHeight:'78%',borderRadius:14,backgroundColor:colors.background,padding:15},modalHeader:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',paddingBottom:10},modalTitle:{fontSize:18,fontWeight:'800',color:colors.text},toolRow:{paddingVertical:11,borderBottomWidth:StyleSheet.hairlineWidth,borderColor:colors.border},toolRowSelected:{backgroundColor:colors.primaryLight},toolName:{color:colors.text,fontFamily:'monospace',fontSize:13},
});}
