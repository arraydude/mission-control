import { QueryClient } from '@tanstack/react-query'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
    mutations: {
      retry: 0,
    },
  },
})

export const missionControlQueryKeys = {
  root: ['mission-control'] as const,
  state: () => [...missionControlQueryKeys.root, 'state'] as const,
  tasks: () => [...missionControlQueryKeys.root, 'tasks'] as const,
  task: (taskId: string) => [...missionControlQueryKeys.tasks(), taskId] as const,
  taskComments: (taskId: string) => [...missionControlQueryKeys.task(taskId), 'comments'] as const,
  agents: () => [...missionControlQueryKeys.root, 'agents'] as const,
  agent: (agentId: string) => [...missionControlQueryKeys.agents(), agentId] as const,
  agentLogs: (agentId: string) => [...missionControlQueryKeys.agent(agentId), 'logs'] as const,
} as const
