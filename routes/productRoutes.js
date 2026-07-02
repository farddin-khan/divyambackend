import supabase from "../../src/config/supabase.js";

/**
 * Get All Products
 * GET /api/products
 */
export const getProducts = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("products")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) throw error;

    res.status(200).json({
      success: true,
      total: data.length,
      products: data,
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};

/**
 * Get Product By ID
 * GET /api/products/:id
 */
export const getProductById = async (req, res) => {
  try {
    const { id } = req.params;

    const { data, error } = await supabase
      .from("products")
      .select("*")
      .eq("id", id)
      .single();

    if (error) throw error;

    if (!data) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    res.status(200).json({
      success: true,
      product: data,
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};

/**
 * Search Products
 * GET /api/products/search?q=ashwagandha
 */
export const searchProducts = async (req, res) => {
  try {
    const { q } = req.query;

    const { data, error } = await supabase
      .from("products")
      .select("*")
      .ilike("name", `%${q}%`);

    if (error) throw error;

    res.status(200).json({
      success: true,
      total: data.length,
      products: data,
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};

/**
 * Get Products By Collection
 * GET /api/products/collection/:collection
 */
export const getProductsByCollection = async (req, res) => {
  try {
    const { collection } = req.params;

    const { data, error } = await supabase
      .from("products")
      .select("*")
      .eq("collection", collection);

    if (error) throw error;

    res.status(200).json({
      success: true,
      total: data.length,
      products: data,
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};

/**
 * Create Product
 * POST /api/products
 */
export const createProduct = async (req, res) => {
  try {
    const {
      name,
      description,
      price,
      image,
      collection,
      stock,
    } = req.body;

    const { data, error } = await supabase
      .from("products")
      .insert([
        {
          name,
          description,
          price,
          image,
          collection,
          stock,
        },
      ])
      .select();

    if (error) throw error;

    res.status(201).json({
      success: true,
      message: "Product created successfully",
      product: data[0],
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};

/**
 * Update Product
 * PUT /api/products/:id
 */
export const updateProduct = async (req, res) => {
  try {
    const { id } = req.params;

    const { data, error } = await supabase
      .from("products")
      .update(req.body)
      .eq("id", id)
      .select();

    if (error) throw error;

    res.status(200).json({
      success: true,
      message: "Product updated successfully",
      product: data[0],
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};

/**
 * Delete Product
 * DELETE /api/products/:id
 */
export const deleteProduct = async (req, res) => {
  try {
    const { id } = req.params;

    const { error } = await supabase
      .from("products")
      .delete()
      .eq("id", id);

    if (error) throw error;

    res.status(200).json({
      success: true,
      message: "Product deleted successfully",
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};