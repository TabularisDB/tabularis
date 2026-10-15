import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock dagre before importing the worker
class MockGraph {
  setDefaultEdgeLabel = vi.fn();
  setGraph = vi.fn();
  setNode = vi.fn();
  setEdge = vi.fn();
  node = vi.fn((id: string) => ({
    x: id === 'node1' ? 100 : 300,
    y: id === 'node1' ? 200 : 400,
    height: id === 'node1' ? 180 : 120,
  }));
}

vi.mock('dagre', () => ({
  default: {
    graphlib: {
      Graph: MockGraph,
    },
    layout: vi.fn(),
  },
}));

// Import mocked utilities
vi.mock('../../src/utils/layoutWorker', () => ({
  NODE_WIDTH: 240,
  NODE_BASE_HEIGHT: 40,
  NODE_ROW_HEIGHT: 28,
  calculateNodeHeight: vi.fn((columns: number) => 40 + columns * 28),
  getNodePositions: vi.fn((direction: string) => ({
    sourcePosition: direction === 'LR' ? 'right' : 'bottom',
    targetPosition: direction === 'LR' ? 'left' : 'top',
  })),
  calculateCenteredPosition: vi.fn((x: number, y: number, width: number, height: number) => ({
    x: x - width / 2,
    y: y - height / 2,
  })),
}));

describe('layoutWorker Web Worker', () => {
  let mockPostMessage: ReturnType<typeof vi.fn>;
  let mockOnMessage: ((e: MessageEvent) => void) | null = null;

  beforeEach(() => {
    // Mock self (global scope in Web Worker)
    mockPostMessage = vi.fn();
    
    // Create a mock self object
    const mockSelf = {
      onmessage: null as ((e: MessageEvent) => void) | null,
      postMessage: mockPostMessage,
    };

    // Set up global self
    (globalThis as unknown as { self: typeof mockSelf }).self = mockSelf;

    // Clear module cache to re-import worker
    vi.resetModules();
  });

  afterEach(() => {
    vi.clearAllMocks();
    delete (globalThis as unknown as { self?: unknown }).self;
  });

  it('should set up onmessage handler', async () => {
    // Import worker which sets up onmessage
    await import('../../src/workers/layoutWorker');

    // Verify that self.onmessage was set
    expect((globalThis as unknown as { self: { onmessage: unknown } }).self.onmessage).toBeDefined();
    expect(typeof (globalThis as unknown as { self: { onmessage: unknown } }).self.onmessage).toBe('function');
  });

  it('should process nodes and edges correctly', async () => {
    // Import worker
    await import('../../src/workers/layoutWorker');

    const onmessage = (globalThis as unknown as { self: { onmessage: (e: MessageEvent) => void } }).self.onmessage;

    const mockNodes = [
      { id: 'node1', data: { columns: [{}, {}, {}] } },
      { id: 'node2', data: { columns: [{}, {}] } },
    ];

    const mockEdges = [
      { source: 'node1', target: 'node2' },
    ];

    // Create mock event
    const mockEvent = {
      data: {
        nodes: mockNodes,
        edges: mockEdges,
        direction: 'LR',
      },
    } as MessageEvent;

    // Call onmessage handler
    onmessage(mockEvent);

    // Verify postMessage was called
    expect(mockPostMessage).toHaveBeenCalledTimes(1);

    // Verify the structure of the response
    const response = mockPostMessage.mock.calls[0][0];
    expect(response).toHaveProperty('nodes');
    expect(response).toHaveProperty('edges');
    expect(Array.isArray(response.nodes)).toBe(true);
    expect(Array.isArray(response.edges)).toBe(true);
  });

  it('should handle empty nodes array', async () => {
    await import('../../src/workers/layoutWorker');

    const onmessage = (globalThis as unknown as { self: { onmessage: (e: MessageEvent) => void } }).self.onmessage;

    const mockEvent = {
      data: {
        nodes: [],
        edges: [],
        direction: 'TB',
      },
    } as MessageEvent;

    onmessage(mockEvent);

    expect(mockPostMessage).toHaveBeenCalledTimes(1);
    const response = mockPostMessage.mock.calls[0][0];
    expect(response.nodes).toHaveLength(0);
    expect(response.edges).toHaveLength(0);
  });

  it('should handle nodes without columns', async () => {
    await import('../../src/workers/layoutWorker');

    const onmessage = (globalThis as unknown as { self: { onmessage: (e: MessageEvent) => void } }).self.onmessage;

    const mockNodes = [
      { id: 'node1' }, // No data property
      { id: 'node2', data: {} }, // No columns
    ];

    const mockEvent = {
      data: {
        nodes: mockNodes,
        edges: [],
        direction: 'LR',
      },
    } as MessageEvent;

    onmessage(mockEvent);

    expect(mockPostMessage).toHaveBeenCalledTimes(1);
    const response = mockPostMessage.mock.calls[0][0];
    expect(response.nodes).toHaveLength(2);
  });

  it('should handle TB direction', async () => {
    await import('../../src/workers/layoutWorker');

    const onmessage = (globalThis as unknown as { self: { onmessage: (e: MessageEvent) => void } }).self.onmessage;

    const mockNodes = [
      { id: 'node1', data: { columns: [{}] } },
    ];

    const mockEvent = {
      data: {
        nodes: mockNodes,
        edges: [],
        direction: 'TB',
      },
    } as MessageEvent;

    onmessage(mockEvent);

    expect(mockPostMessage).toHaveBeenCalledTimes(1);
    const response = mockPostMessage.mock.calls[0][0];
    expect(response.nodes[0]).toHaveProperty('sourcePosition', 'bottom');
    expect(response.nodes[0]).toHaveProperty('targetPosition', 'top');
  });

  it('should handle LR direction', async () => {
    await import('../../src/workers/layoutWorker');

    const onmessage = (globalThis as unknown as { self: { onmessage: (e: MessageEvent) => void } }).self.onmessage;

    const mockNodes = [
      { id: 'node1', data: { columns: [{}] } },
    ];

    const mockEvent = {
      data: {
        nodes: mockNodes,
        edges: [],
        direction: 'LR',
      },
    } as MessageEvent;

    onmessage(mockEvent);

    expect(mockPostMessage).toHaveBeenCalledTimes(1);
    const response = mockPostMessage.mock.calls[0][0];
    expect(response.nodes[0]).toHaveProperty('sourcePosition', 'right');
    expect(response.nodes[0]).toHaveProperty('targetPosition', 'left');
  });

  it('should handle multiple edges', async () => {
    await import('../../src/workers/layoutWorker');

    const onmessage = (globalThis as unknown as { self: { onmessage: (e: MessageEvent) => void } }).self.onmessage;

    const mockNodes = [
      { id: 'node1', data: { columns: [{}] } },
      { id: 'node2', data: { columns: [{}] } },
      { id: 'node3', data: { columns: [{}] } },
    ];

    const mockEdges = [
      { source: 'node1', target: 'node2' },
      { source: 'node2', target: 'node3' },
      { source: 'node1', target: 'node3' },
    ];

    const mockEvent = {
      data: {
        nodes: mockNodes,
        edges: mockEdges,
        direction: 'TB',
      },
    } as MessageEvent;

    onmessage(mockEvent);

    expect(mockPostMessage).toHaveBeenCalledTimes(1);
    const response = mockPostMessage.mock.calls[0][0];
    expect(response.nodes).toHaveLength(3);
    expect(response.edges).toHaveLength(3);
  });

  it('should preserve node properties in output', async () => {
    await import('../../src/workers/layoutWorker');

    const onmessage = (globalThis as unknown as { self: { onmessage: (e: MessageEvent) => void } }).self.onmessage;

    const mockNodes = [
      { 
        id: 'node1', 
        data: { columns: [{ name: 'id' }], label: 'Users' },
        type: 'custom',
        style: { background: 'red' },
      },
    ];

    const mockEvent = {
      data: {
        nodes: mockNodes,
        edges: [],
        direction: 'TB',
      },
    } as MessageEvent;

    onmessage(mockEvent);

    const response = mockPostMessage.mock.calls[0][0];
    const outputNode = response.nodes[0];
    
    // Verify original properties are preserved
    expect(outputNode.id).toBe('node1');
    expect(outputNode.data).toEqual({ columns: [{ name: 'id' }], label: 'Users' });
    expect(outputNode.type).toBe('custom');
    expect(outputNode.style).toEqual({ background: 'red' });
    
    // Verify new properties were added
    expect(outputNode).toHaveProperty('position');
    expect(outputNode).toHaveProperty('sourcePosition');
    expect(outputNode).toHaveProperty('targetPosition');
  });

  it('should pass edges through unchanged', async () => {
    await import('../../src/workers/layoutWorker');

    const onmessage = (globalThis as unknown as { self: { onmessage: (e: MessageEvent) => void } }).self.onmessage;

    const mockEdges = [
      { source: 'node1', target: 'node2', animated: true },
      { source: 'node2', target: 'node3', label: 'FK' },
    ];

    const mockEvent = {
      data: {
        nodes: [{ id: 'node1' }, { id: 'node2' }, { id: 'node3' }],
        edges: mockEdges,
        direction: 'TB',
      },
    } as MessageEvent;

    onmessage(mockEvent);

    const response = mockPostMessage.mock.calls[0][0];
    expect(response.edges).toEqual(mockEdges);
  });

  it('should handle many columns', async () => {
    await import('../../src/workers/layoutWorker');

    const onmessage = (globalThis as unknown as { self: { onmessage: (e: MessageEvent) => void } }).self.onmessage;

    const manyColumns = Array(50).fill({});
    const mockNodes = [
      { id: 'node1', data: { columns: manyColumns } },
    ];

    const mockEvent = {
      data: {
        nodes: mockNodes,
        edges: [],
        direction: 'TB',
      },
    } as MessageEvent;

    onmessage(mockEvent);

    expect(mockPostMessage).toHaveBeenCalledTimes(1);
    const response = mockPostMessage.mock.calls[0][0];
    expect(response.nodes).toHaveLength(1);
  });

  it('should handle complex graph structure', async () => {
    await import('../../src/workers/layoutWorker');

    const onmessage = (globalThis as unknown as { self: { onmessage: (e: MessageEvent) => void } }).self.onmessage;

    const mockNodes = [
      { id: 'users', data: { columns: [{}, {}, {}, {}] } },
      { id: 'orders', data: { columns: [{}, {}, {}] } },
      { id: 'products', data: { columns: [{}, {}, {}, {}, {}] } },
      { id: 'categories', data: { columns: [{}, {}] } },
    ];

    const mockEdges = [
      { source: 'users', target: 'orders' },
      { source: 'orders', target: 'products' },
      { source: 'products', target: 'categories' },
      { source: 'users', target: 'products' },
    ];

    const mockEvent = {
      data: {
        nodes: mockNodes,
        edges: mockEdges,
        direction: 'LR',
      },
    } as MessageEvent;

    onmessage(mockEvent);

    expect(mockPostMessage).toHaveBeenCalledTimes(1);
    const response = mockPostMessage.mock.calls[0][0];
    
    expect(response.nodes).toHaveLength(4);
    expect(response.edges).toHaveLength(4);
    
    // Verify all nodes have required properties
    response.nodes.forEach((node: Record<string, unknown>) => {
      expect(node).toHaveProperty('id');
      expect(node).toHaveProperty('position');
      expect(node).toHaveProperty('sourcePosition');
      expect(node).toHaveProperty('targetPosition');
    });
  });
});
