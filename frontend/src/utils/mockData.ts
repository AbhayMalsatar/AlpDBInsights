type DataContext = string

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const ITEMS = ['Laptop', 'Phone', 'Tablet', 'Monitor', 'Keyboard', 'Mouse', 'Headset', 'Camera', 'Speaker', 'Printer']
const CATEGORIES = ['Electronics', 'Furniture', 'Stationery', 'Software', 'Hardware']
const REGIONS = ['North', 'South', 'East', 'West', 'Central']
const CUSTOMERS = ['Acme Corp', 'Global Tech', 'StartupXYZ', 'MegaCo', 'LocalBiz', 'TechCorp', 'DataInc', 'CloudSys']

function rand(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

export function generateMockChartData(chartType: string, context: DataContext): Record<string, unknown>[] {
  const ctx = context.toLowerCase()

  if (chartType === 'pie') {
    if (ctx.includes('region')) {
      return REGIONS.map((region) => ({ region, sales: rand(50000, 300000) }))
    }
    if (ctx.includes('categor')) {
      return CATEGORIES.map((category) => ({ category, value: rand(20000, 150000) }))
    }
    return ITEMS.slice(0, 6).map((item) => ({ item, revenue: rand(15000, 120000) }))
  }

  if (chartType === 'line' || chartType === 'area') {
    if (ctx.includes('purchase')) {
      return MONTHS.map((month) => ({
        month,
        purchases: rand(30000, 120000),
        budget: rand(50000, 100000),
      }))
    }
    if (ctx.includes('revenue') || ctx.includes('sales')) {
      return MONTHS.map((month) => ({
        month,
        revenue: rand(80000, 350000),
        target: rand(100000, 300000),
      }))
    }
    return MONTHS.map((month) => ({
      month,
      value: rand(40000, 200000),
    }))
  }

  if (chartType === 'table') {
    if (ctx.includes('top') || ctx.includes('product')) {
      return ITEMS.map((item, i) => ({
        rank: i + 1,
        product: item,
        quantity_sold: rand(100, 2000),
        revenue: rand(5000, 150000).toLocaleString(),
        growth: `${rand(-20, 50)}%`,
        stock: rand(0, 500),
      }))
    }
    if (ctx.includes('customer')) {
      return CUSTOMERS.map((customer, i) => ({
        rank: i + 1,
        customer,
        orders: rand(5, 200),
        total_spent: rand(10000, 500000).toLocaleString(),
        region: REGIONS[i % REGIONS.length],
        last_order: `2024-${String(rand(1, 12)).padStart(2, '0')}-${String(rand(1, 28)).padStart(2, '0')}`,
      }))
    }
    return Array.from({ length: 10 }, (_, i) => ({
      id: i + 1,
      name: ITEMS[i % ITEMS.length],
      value: rand(1000, 50000),
      status: ['Active', 'Pending', 'Completed'][rand(0, 2)],
      date: `2024-${String(rand(1, 12)).padStart(2, '0')}-${String(rand(1, 28)).padStart(2, '0')}`,
    }))
  }

  // Default: bar chart
  if (ctx.includes('item') || ctx.includes('product')) {
    return ITEMS.map((item) => ({
      item,
      sales: rand(100, 1500),
      revenue: rand(10000, 150000),
    }))
  }

  if (ctx.includes('purchase')) {
    return ITEMS.slice(0, 7).map((item) => ({
      item,
      quantity: rand(50, 800),
      cost: rand(5000, 80000),
    }))
  }

  if (ctx.includes('stock')) {
    return CATEGORIES.map((category) => ({
      category,
      in_stock: rand(200, 2000),
      low_stock: rand(0, 100),
    }))
  }

  if (ctx.includes('region') || ctx.includes('area')) {
    return REGIONS.map((region) => ({
      region,
      sales: rand(50000, 400000),
    }))
  }

  if (ctx.includes('customer')) {
    return CUSTOMERS.slice(0, 8).map((customer) => ({
      customer,
      orders: rand(10, 200),
      revenue: rand(5000, 100000),
    }))
  }

  // Generic fallback
  return Array.from({ length: 8 }, (_, i) => ({
    label: `Category ${i + 1}`,
    value: rand(1000, 50000),
  }))
}
