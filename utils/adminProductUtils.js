export function normalizeBoolean(value) {
  return value === true || value === 'true' || value === 1 || value === '1';
}

export function normalizeBenefits(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

export function normalizeImages(value) {
  if (Array.isArray(value)) {
    return value.filter(Boolean);
  }
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

export function buildProductPayload(product, processedImages = []) {
  const benefits = normalizeBenefits(product?.benefits);

  return {
    name: product?.name || '',
    slug: product?.slug || '',
    description: product?.description || '',
    short_description: product?.short_description || '',
    price: Number(product?.price) || 0,
    compare_price: product?.compare_price ? Number(product.compare_price) : null,
    sku: product?.sku || null,
    stock_quantity: product?.stock_quantity ? Number(product.stock_quantity) : 0,
    weight: product?.weight || null,
    category_id: product?.category_id ? Number(product.category_id) : null,
    images: processedImages,
    featured: normalizeBoolean(product?.featured),
    best_seller: normalizeBoolean(product?.best_seller),
    new_arrival: normalizeBoolean(product?.new_arrival),
    ingredients: product?.ingredients || null,
    how_to_use: product?.how_to_use || null,
    benefits,
    meta_title: product?.meta_title || null,
    meta_description: product?.meta_description || null,
    updated_at: new Date().toISOString(),
  };
}
