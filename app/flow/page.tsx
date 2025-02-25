'use client'

import { useState, useCallback, useEffect, useMemo } from 'react'
import type {
  Node,
  Edge,
  Connection,
  NodeTypes,
  NodeChange,
  EdgeChange,
  XYPosition,
  EdgeTypes,
  CoordinateExtent,
} from '@xyflow/react'
import {
  ReactFlow,
  Controls,
  Background,
  addEdge,
  applyNodeChanges,
  applyEdgeChanges,
  MiniMap,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Brain,
  Search,
  FileText,
  Loader2,
  Save,
  AlertTriangle,
} from 'lucide-react'
import { SearchNode } from '@/components/flow/search-node'
import { ReportNode } from '@/components/flow/report-node'
import { SelectionNode } from '@/components/flow/selection-node'
import { QuestionNode } from '@/components/flow/question-node'
import { ConsolidatedEdge } from '@/components/flow/consolidated-edge'
import type { SearchResult, Report } from '@/types'
import { ModelSelect, DEFAULT_MODEL } from '@/components/model-select'
import { handleLocalFile } from '@/lib/file-upload'
import { useToast } from '@/hooks/use-toast'
import { useFlowProjects } from '@/hooks/use-flow-projects'
import { ProjectSelector } from '@/components/project-selector'
import Link from 'next/link'
import { ProjectActions } from '@/components/project-actions'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

const nodeTypes: NodeTypes = {
  searchNode: SearchNode,
  reportNode: ReportNode,
  selectionNode: SelectionNode,
  questionNode: QuestionNode,
}

const edgeTypes: EdgeTypes = {
  consolidated: ConsolidatedEdge,
}

interface ResearchNode extends Node {
  data: {
    id?: string
    query?: string
    loading?: boolean
    results?: SearchResult[]
    report?: Report
    searchTerms?: string[]
    question?: string
    parentId?: string
    childIds?: string[]
    onGenerateReport?: (selectedResults: SearchResult[], prompt: string) => void
    onApprove?: (term?: string) => void
    onConsolidate?: () => void
    hasChildren?: boolean
    error?: string
    isSelected?: boolean
    onSelect?: (id: string) => void
    isConsolidated?: boolean
    isConsolidating?: boolean
    onFileUpload?: (file: File) => void
  }
  style?: React.CSSProperties
  extent?: 'parent' | CoordinateExtent
}

// Configuration for different node types
const NODE_CONFIG = {
  group: { zIndex: 0 },
  searchNode: { zIndex: 1 },
  selectionNode: { zIndex: 2 },
  reportNode: { zIndex: 3 },
  questionNode: { zIndex: 3 }
};

// Group node style
const GROUP_NODE_STYLE: React.CSSProperties = {
  width: 800,
  height: 1600,
  padding: 60,
  backgroundColor: 'rgba(240, 240, 240, 0.5)',
  borderRadius: 8,
};

// Custom hook for handling the research workflow
function useResearchFlow(
  createNode: (type: string, position: XYPosition, data: Partial<ResearchNode['data']>, parentId?: string) => ResearchNode,
  setNodes: React.Dispatch<React.SetStateAction<ResearchNode[]>>,
  setEdges: React.Dispatch<React.SetStateAction<Edge[]>>,
  selectedModel: string
) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  
  // Handle file upload for search nodes
  const handleFileUpload = useCallback(async (
    file: File,
    searchNodeId: string,
    groupId: string
  ) => {
    const result = await handleLocalFile(
      file,
      (loading) => {
        setNodes((nds) =>
          nds.map((node) =>
            node.id === searchNodeId
              ? { ...node, data: { ...node.data, loading } }
              : node
          )
        )
      },
      (error, context) => {
        toast({
          title: context,
          description: error instanceof Error ? error.message : String(error),
          variant: 'destructive',
        })
      }
    )

    if (result) {
      setNodes((nds) => {
        const selectionNode = nds.find(
          (n) => n.type === 'selectionNode' && n.parentId === groupId
        )

        if (selectionNode) {
          return nds.map((node) =>
            node.id === selectionNode.id
              ? {
                  ...node,
                  data: {
                    ...node.data,
                    results: [result, ...(node.data.results || [])],
                  },
                }
              : node.id === searchNodeId
              ? { ...node, data: { ...node.data, loading: false } }
              : node
          )
        }

        const newSelectionNode = createNode(
          'selectionNode',
          { x: 100, y: 200 },
          {
            results: [result],
            onGenerateReport: (selected, prompt) => {
              handleGenerateReport(selected, searchNodeId, groupId, prompt)
            },
            childIds: [],
          },
          groupId
        )

        return [
          ...nds.map((n) =>
            n.id === searchNodeId
              ? { ...n, data: { ...n.data, loading: false } }
              : n
          ),
          newSelectionNode,
        ]
      })
    }
  }, [createNode, setNodes, toast]);

  // Start a new research flow
  const startResearch = useCallback(async (
    query: string,
    parentReportId?: string,
    nodes?: ResearchNode[]
  ) => {
    if (!query.trim()) return;

    setLoading(true);
    try {
      const randomOffset = {
        x: Math.floor(Math.random() * 600) - 300,
        y: Math.floor(Math.random() * 300),
      };

      const basePosition = {
        x: parentReportId
          ? nodes?.find((n) => n.id === parentReportId)?.position.x || 0
          : (nodes?.length || 0) * 200,
        y: parentReportId
          ? (nodes?.find((n) => n.id === parentReportId)?.position.y || 0) + 400
          : 0,
      };

      const groupPosition = {
        x: Math.max(0, basePosition.x + randomOffset.x),
        y: Math.max(0, basePosition.y + randomOffset.y),
      };

      const groupNode = createNode('group', groupPosition, { query });

      const searchNode = createNode(
        'searchNode',
        { x: 100, y: 80 },
        {
          query,
          loading: true,
          childIds: [],
          onFileUpload: (file: File) =>
            handleFileUpload(file, searchNode.id, groupNode.id),
        },
        groupNode.id
      );

      setNodes((nds) => [...nds, groupNode, searchNode]);

      const response = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query,
          timeFilter: 'all',
          platformModel: selectedModel,
        }),
      });

      if (!response.ok) {
        const errorData = await response
          .json()
          .catch(() => ({ error: 'Search failed' }));
        throw new Error(errorData.error || `Search failed: ${response.status}`);
      }
      
      const data = await response.json();
      console.log('Search response:', data);

      if (!data.webPages?.value?.length) {
        throw new Error('No search results found');
      }

      const searchResults = data.webPages.value.map((result: any) => ({
        id: result.id || `result-${Date.now()}-${Math.random()}`,
        url: result.url,
        name: result.name || result.title,
        snippet: result.snippet,
        isCustomUrl: false,
      }));

      console.log('Transformed search results:', searchResults);

      const selectionNode = createNode(
        'selectionNode',
        { x: 100, y: 200 },
        {
          results: searchResults,
          onGenerateReport: (selected, prompt) => {
            console.log('Generate report clicked with:', selected, prompt);
            handleGenerateReport(selected, searchNode.id, groupNode.id, prompt);
          },
          childIds: [],
        },
        groupNode.id
      );

      setNodes((nds) => {
        const updatedNodes = nds.map((node) =>
          node.id === searchNode.id
            ? { ...node, data: { ...node.data, loading: false } }
            : node
        );
        return [...updatedNodes, selectionNode];
      });

      setEdges((eds) => [
        ...eds,
        {
          id: `edge-${searchNode.id}-${selectionNode.id}`,
          source: searchNode.id,
          target: selectionNode.id,
          animated: true,
        },
      ]);
    } catch (error) {
      console.error('Search error:', error);
      setNodes((nds) =>
        nds.map((node) =>
          node.data.loading
            ? {
                ...node,
                data: {
                  ...node.data,
                  loading: false,
                  error:
                    error instanceof Error ? error.message : 'Search failed',
                },
              }
            : node
        )
      );
    } finally {
      setLoading(false);
    }
  }, [createNode, selectedModel, setEdges, setNodes]);

  // Generate a report from selected search results
  const handleGenerateReport = useCallback(async (
    selectedResults: SearchResult[],
    searchNodeId: string,
    groupId: string,
    prompt: string
  ) => {
    console.log('handleGenerateReport called with:', {
      selectedResults,
      searchNodeId,
      groupId,
      prompt,
    });

    if (selectedResults.length === 0) {
      console.error('No results selected');
      return;
    }

    const reportNode = createNode(
      'reportNode',
      { x: 100, y: 800 },
      {
        loading: true,
        hasChildren: false,
      },
      groupId
    );

    const searchTermsNode = createNode(
      'questionNode',
      { x: 100, y: 1000 },
      {
        loading: true,
      },
      groupId
    );

    setNodes((nds) => [...nds, reportNode, searchTermsNode]);

    setEdges((eds) => [
      ...eds,
      {
        id: `edge-${searchNodeId}-${reportNode.id}`,
        source: searchNodeId,
        target: reportNode.id,
        animated: true,
      },
      {
        id: `edge-${reportNode.id}-${searchTermsNode.id}`,
        source: reportNode.id,
        target: searchTermsNode.id,
        animated: true,
      },
    ]);

    try {
      const contentResults = await Promise.all(
        selectedResults.map(async (result) => {
          if (result.content) {
            return {
              url: result.url,
              title: result.name,
              content: result.content,
            };
          }

          try {
            const response = await fetch('/api/fetch-content', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ url: result.url }),
            });
            if (!response.ok) throw new Error('Failed to fetch content');
            const { content } = await response.json();
            return {
              url: result.url,
              title: result.name,
              content: content || result.snippet,
            };
          } catch (error) {
            console.error('Content fetch error:', error);
            return {
              url: result.url,
              title: result.name,
              content: result.snippet,
            };
          }
        })
      );

      const validResults = contentResults.filter((r) => r.content?.trim());
      if (validResults.length === 0) {
        throw new Error('No valid content found in selected results');
      }

      const reportResponse = await fetch('/api/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          selectedResults: validResults,
          sources: selectedResults,
          prompt:
            prompt || 'Provide comprehensive analysis of the selected sources.',
          platformModel: selectedModel,
        }),
      });

      if (!reportResponse.ok) {
        const errorData = await reportResponse
          .json()
          .catch(() => ({ error: 'Failed to generate report' }));
        throw new Error(
          errorData.error ||
            `Failed to generate report: ${reportResponse.status}`
        );
      }

      const report = await reportResponse.json();

      const searchTermsResponse = await fetch('/api/generate-question', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          report,
          platformModel: selectedModel,
        }),
      });

      if (!searchTermsResponse.ok) {
        const errorData = await searchTermsResponse
          .json()
          .catch(() => ({ error: 'Failed to generate search terms' }));
        throw new Error(
          errorData.error ||
            `Failed to generate search terms: ${searchTermsResponse.status}`
        );
      }

      const { searchTerms } = await searchTermsResponse.json();

      setNodes((nds) =>
        nds.map((node) => {
          if (node.id === reportNode.id) {
            return {
              ...node,
              data: {
                ...node.data,
                report,
                loading: false,
              },
            };
          }
          if (node.id === searchTermsNode.id) {
            return {
              ...node,
              data: {
                ...node.data,
                searchTerms,
                loading: false,
                onApprove: (term?: string) => {
                  if (term) {
                    // Pass up the term to set the query
                    return term;
                  }
                },
              },
            };
          }
          return node;
        })
      );
      
      return { success: true, report, searchTerms };
    } catch (error) {
      console.error('Report generation error:', error);
      setNodes((nds) =>
        nds.map((node) => {
          if (node.id === reportNode.id || node.id === searchTermsNode.id) {
            return {
              ...node,
              data: {
                ...node.data,
                loading: false,
                error:
                  error instanceof Error ? error.message : 'Generation failed',
              },
            };
          }
          return node;
        })
      );
      return { success: false, error };
    }
  }, [createNode, selectedModel, setEdges, setNodes]);

  return {
    loading,
    startResearch,
    handleGenerateReport,
    handleFileUpload
  };
}

// Custom hook for handling consolidation of reports
function useConsolidation(
  createNode: (type: string, position: XYPosition, data: Partial<ResearchNode['data']>, parentId?: string) => ResearchNode,
  nodes: ResearchNode[],
  setNodes: React.Dispatch<React.SetStateAction<ResearchNode[]>>,
  setEdges: React.Dispatch<React.SetStateAction<Edge[]>>,
  selectedModel: string
) {
  const [isConsolidating, setIsConsolidating] = useState(false);

  const consolidateReports = useCallback(async (selectedReports: string[]) => {
    if (selectedReports.length < 2) {
      console.error('Select at least 2 reports to consolidate');
      return { success: false, error: 'Select at least 2 reports to consolidate' };
    }

    setIsConsolidating(true);
    try {
      const reportsToConsolidate = nodes
        .filter((node) => selectedReports.includes(node.id) && node.data.report)
        .map((node) => node.data.report!);

      console.log('Consolidating reports:', {
        numReports: reportsToConsolidate.length,
        reportTitles: reportsToConsolidate.map((r) => r.title),
      });

      const response = await fetch('/api/consolidate-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reports: reportsToConsolidate,
          platformModel: selectedModel,
        }),
      });

      if (!response.ok)
        throw new Error('Failed to generate consolidated report');
      const consolidated: Report = await response.json();

      console.log('Received consolidated report:', consolidated);

      const groupNode = createNode(
        'group',
        {
          x:
            Math.max(
              ...selectedReports.map(
                (id) => nodes.find((n) => n.id === id)?.position.x || 0
              )
            ) + 1000,
          y: Math.min(
            ...selectedReports.map(
              (id) => nodes.find((n) => n.id === id)?.position.y || 0
            )
          ),
        },
        { query: 'Consolidated Research' }
      );

      const consolidatedNode = createNode(
        'reportNode',
        { x: 100, y: 100 },
        {
          report: consolidated,
          loading: false,
          childIds: [],
          hasChildren: false,
          isConsolidated: true,
        },
        groupNode.id
      );

      setNodes((nds) => {
        const updatedNodes = nds.map((node) => {
          if (selectedReports.includes(node.id)) {
            return {
              ...node,
              data: { ...node.data, isSelected: false },
            };
          }
          return node;
        });
        return [...updatedNodes, groupNode, consolidatedNode];
      });

      setEdges((eds) => [
        ...eds,
        ...selectedReports.map((reportId) => ({
          id: `edge-${reportId}-${consolidatedNode.id}`,
          source: reportId,
          target: consolidatedNode.id,
          animated: true,
          type: 'consolidated',
        })),
      ]);

      return { success: true, consolidated };
    } catch (error) {
      console.error('Consolidation error:', error);
      return { success: false, error };
    } finally {
      setIsConsolidating(false);
    }
  }, [createNode, nodes, selectedModel, setEdges, setNodes]);

  return {
    isConsolidating,
    consolidateReports
  };
}

export default function FlowPage() {
  const [nodes, setNodes] = useState<ResearchNode[]>([])
  const [edges, setEdges] = useState<Edge[]>([])
  const [query, setQuery] = useState('')
  const [selectedReports, setSelectedReports] = useState<string[]>([])
  const [selectedModel, setSelectedModel] = useState(DEFAULT_MODEL)
  const { toast } = useToast()
  const {
    projects,
    currentProject,
    setCurrentProject,
    createProject,
    updateCurrentProject,
    deleteProject,
    saveCurrentState,
    exportProjects,
    importProjects,
    storageInfo,
    refreshStorageInfo,
  } = useFlowProjects()

  // Memoized functions for node and edge changes
  const onNodesChange = useCallback(
    (changes: NodeChange[]) => setNodes((nds) => applyNodeChanges(changes, nds)),
    []
  )

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => setEdges((eds) => applyEdgeChanges(changes, eds)),
    []
  )

  const onConnect = useCallback(
    (params: Connection) => setEdges((eds) => addEdge(params, eds)),
    []
  )

  // Report selection handler
  const handleReportSelect = useCallback((reportId: string) => {
    console.log(`Report selection toggled: ${reportId}`)

    setSelectedReports((prev) => {
      const isCurrentlySelected = prev.includes(reportId)
      const newSelected = isCurrentlySelected
        ? prev.filter((id) => id !== reportId)
        : [...prev, reportId]

      return newSelected
    })
  }, [])

  // Generic function to create nodes
  const createNode = useCallback(
    (
      type: string,
      position: XYPosition,
      data: Partial<ResearchNode['data']>,
      parentId?: string
    ): ResearchNode => {
      const id = data.id || `${type}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
      
      const zIndex = NODE_CONFIG[type as keyof typeof NODE_CONFIG]?.zIndex || 1;
      
      // Special handling for report nodes
      const nodeData = 
        type === 'reportNode'
          ? {
              ...data,
              id,
              childIds: data.childIds || [],
              isSelected: selectedReports.includes(id),
              onSelect: (nodeId: string) => handleReportSelect(nodeId),
              isConsolidating: false, // Will be updated by consolidation hook when needed
            }
          : { ...data, id, childIds: data.childIds || [] };

      const node: ResearchNode = {
        id,
        type,
        position: {
          x: Math.max(0, Math.round(position.x)),
          y: Math.max(0, Math.round(position.y)),
        },
        data: nodeData as ResearchNode['data'],
        parentId,
        extent: 'parent',
        zIndex,
      };
      
      // Apply group style if it's a group node
      if (type === 'group') {
        node.style = GROUP_NODE_STYLE;
      }
      
      return node;
    },
    [selectedReports]
  )

  // Use the research flow hook
  const { 
    loading: researchLoading, 
    startResearch, 
    handleGenerateReport,
    handleFileUpload
  } = useResearchFlow(createNode, setNodes, setEdges, selectedModel);

  // Use the consolidation hook
  const {
    isConsolidating,
    consolidateReports
  } = useConsolidation(createNode, nodes, setNodes, setEdges, selectedModel);

  // Auto-save state to current project whenever it changes
  useEffect(() => {
    const saveTimer = setTimeout(() => {
      saveCurrentState(nodes, edges, query, selectedReports)
    }, 1000)

    return () => clearTimeout(saveTimer)
  }, [nodes, edges, query, selectedReports, saveCurrentState])

  // Initialize from current project
  useEffect(() => {
    if (currentProject) {
      console.log('Loading project:', currentProject.name)
      console.log('Selected reports:', currentProject.selectedReports || [])

      // First set selected reports
      if (
        currentProject.selectedReports &&
        currentProject.selectedReports.length > 0
      ) {
        setSelectedReports(currentProject.selectedReports)
      } else {
        setSelectedReports([])
      }

      // Then set nodes with the selection state
      const nodesWithSelectionAndCallbacks = (
        currentProject.nodes as ResearchNode[]
      ).map((node) => {
        if (node.type === 'reportNode') {
          return {
            ...node,
            data: {
              ...node.data,
              id: node.id, // Ensure ID is in the data
              isSelected: (currentProject.selectedReports || []).includes(
                node.id
              ),
              onSelect: (id: string) => handleReportSelect(id),
            },
          }
        }
        return {
          ...node,
          data: {
            ...node.data,
            id: node.id, // Ensure ID is in the data
          },
        }
      })

      setNodes(nodesWithSelectionAndCallbacks)
      setEdges(currentProject.edges)
      setQuery(currentProject.query)
    }
  }, [currentProject, handleReportSelect])

  // Update node isSelected state when selectedReports changes
  useEffect(() => {
    setNodes((nds) =>
      nds.map((node) => {
        if (node.type === 'reportNode') {
          return {
            ...node,
            data: {
              ...node.data,
              isSelected: selectedReports.includes(node.id),
            },
          }
        }
        return node
      })
    )
  }, [selectedReports])

  // Simplified handler that uses the research flow hook
  const handleStartResearch = useCallback(async (parentReportId?: string) => {
    if (!query.trim()) return;
    await startResearch(query, parentReportId, nodes);
  }, [query, nodes, startResearch]);

  // Handle report consolidation
  const handleConsolidateSelected = useCallback(async () => {
    const result = await consolidateReports(selectedReports);
    if (result.success) {
      setSelectedReports([]);
    } else if (result.error) {
      toast({
        title: "Consolidation Failed",
        description: String(result.error),
        variant: "destructive"
      });
    }
  }, [consolidateReports, selectedReports, toast]);

  // Project management functions
  const handleCreateNewProject = useCallback((name: string) => {
    createProject(name)
    setNodes([])
    setEdges([])
    setQuery('')
  }, [createProject, setNodes, setEdges, setQuery]);

  const handleRenameProject = useCallback((id: string, name: string) => {
    if (currentProject && currentProject.id === id) {
      updateCurrentProject({ name })
    }
  }, [currentProject, updateCurrentProject]);

  // Debug function to check node selection state
  useEffect(() => {
    if (typeof window !== 'undefined') {
      // @ts-ignore
      window.debugFlowSelection = () => {
        console.log('Current selected reports:', selectedReports)
        console.log(
          'Report nodes:',
          nodes
            .filter((n) => n.type === 'reportNode')
            .map((n) => ({
              id: n.id,
              isSelected: n.data.isSelected,
              onSelect: Boolean(n.data.onSelect),
              report: n.data.report?.title,
            }))
        )
      }
    }
  }, [nodes, selectedReports])

  return (
    <div className='h-screen flex flex-col'>
      <nav className='border-b bg-white shadow-sm'>
        <div className='max-w-7xl mx-auto px-4 sm:px-6 lg:px-8'>
          <div className='flex justify-between h-16'>
            {/* Logo and main navigation */}
            <div className='flex items-center'>
              <div className='flex-shrink-0 flex items-center'>
                <Link href='/' className='font-bold text-xl text-primary'>
                  <img
                    src='/apple-icon.png'
                    alt='Open Deep Research'
                    className='h-8 w-8 rounded-full'
                  />
                </Link>
              </div>
              <div className='hidden sm:ml-6 sm:flex sm:space-x-4'>
                <Button asChild variant='ghost' size='sm'>
                  <Link href='/'>Home</Link>
                </Button>
                <Button asChild variant='ghost' size='sm'>
                  <Link
                    href='https://www.loom.com/share/3c4d9811ac1d47eeaa7a0907c43aef7f'
                    target='_blank'
                    rel='noopener noreferrer'
                  >
                    Watch Demo
                  </Link>
                </Button>
              </div>
            </div>

            {/* Project controls */}
            <div className='flex items-center gap-2'>
              <ProjectSelector
                projects={projects}
                currentProject={currentProject}
                onSelectProject={setCurrentProject}
                onCreateProject={handleCreateNewProject}
                onDeleteProject={deleteProject}
                onRenameProject={handleRenameProject}
              />
              <ProjectActions
                exportProjects={exportProjects}
                importProjects={importProjects}
                storageInfo={storageInfo}
                refreshStorageInfo={refreshStorageInfo}
              />

              {/* Mobile menu */}
              <div className='sm:hidden flex items-center'>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant='ghost' size='icon' className='h-8 w-8'>
                      <svg
                        xmlns='http://www.w3.org/2000/svg'
                        fill='none'
                        viewBox='0 0 24 24'
                        strokeWidth={1.5}
                        stroke='currentColor'
                        className='w-5 h-5'
                      >
                        <path
                          strokeLinecap='round'
                          strokeLinejoin='round'
                          d='M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5'
                        />
                      </svg>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align='end'>
                    <DropdownMenuItem asChild>
                      <Link href='/'>Home</Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <Link
                        href='https://www.loom.com/share/3c4d9811ac1d47eeaa7a0907c43aef7f'
                        target='_blank'
                        rel='noopener noreferrer'
                      >
                        Watch Demo
                      </Link>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </div>
        </div>
      </nav>

      <div className='p-4 bg-gray-50'>
        <div className='max-w-4xl mx-auto flex flex-col gap-4'>
          <div className='flex flex-col sm:flex-row gap-4'>
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder='Enter research topic'
              className='flex-1 min-w-0'
            />
            <Button
              onClick={() => handleStartResearch()}
              disabled={researchLoading}
              className='gap-2 whitespace-nowrap'
            >
              {researchLoading ? (
                <>
                  <Brain className='h-4 w-4 animate-spin' />
                  Researching...
                </>
              ) : (
                <>
                  <Search className='h-4 w-4' />
                  Start Research
                </>
              )}
            </Button>
          </div>
          <div className='flex flex-col sm:flex-row items-start sm:items-center gap-4'>
            <div className='flex flex-col sm:flex-row items-start sm:items-center gap-2 w-full sm:w-auto'>
              <p className='text-sm text-gray-500 whitespace-nowrap'>
                Model for report generation:
              </p>
              <ModelSelect
                value={selectedModel}
                onValueChange={setSelectedModel}
                triggerClassName='w-full sm:w-[200px]'
              />
            </div>
            <Button
              onClick={handleConsolidateSelected}
              disabled={selectedReports.length < 2 || isConsolidating}
              variant='outline'
              className='gap-2 w-full sm:w-auto sm:ml-auto'
            >
              {isConsolidating ? (
                <>
                  <Loader2 className='h-4 w-4 animate-spin' />
                  Consolidating...
                </>
              ) : (
                <>
                  <FileText className='h-4 w-4' />
                  Consolidate Selected ({selectedReports.length})
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
      <div className='flex-1 w-full h-0 relative overflow-hidden'>
        {nodes.some((node) => node.data.error) && (
          <div className='absolute top-0 left-0 right-0 z-10 p-3 bg-red-50 border-b border-red-200'>
            <div className='max-w-4xl mx-auto flex items-center gap-2 text-red-700'>
              <AlertTriangle className='h-4 w-4' />
              <p className='text-sm'>
                {nodes.find((node) => node.data.error)?.data.error ||
                  'An error occurred during the operation. Please try again.'}
              </p>
            </div>
          </div>
        )}
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          fitView
          minZoom={0.1}
          maxZoom={1.5}
          defaultViewport={{ x: 0, y: 0, zoom: 1 }}
          className='transition-all duration-200'
        >
          <MiniMap
            nodeStrokeWidth={3}
            className='!bottom-4 !right-4 !left-auto'
            pannable
            zoomable
          />
          <Background />
          <Controls
            className='!top-4 !right-4 !left-auto !bottom-auto'
            showInteractive={false}
          />
        </ReactFlow>
      </div>
    </div>
  )
}
