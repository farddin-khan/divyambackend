import supabase from "../../src/config/supabase.js";

/**
 * Create Order
 * POST /api/orders
 */
export const createOrder = async (req, res, next) => {
  try {
    const {
      customer_name,
      customer_email,
      customer_phone,
      address,
      city,
      state,
      pincode,
      payment_method,
      total_amount,
      products,
    } = req.body;

    if (
      !customer_name ||
      !customer_phone ||
      !address ||
      !city ||
      !state ||
      !pincode ||
      !total_amount
    ) {
      return res.status(400).json({
        success: false,
        message: "Required fields are missing.",
      });
    }

    const { data, error } = await supabase
      .from("orders")
      .insert([
        {
          customer_name,
          customer_email,
          customer_phone,
          address,
          city,
          state,
          pincode,
          payment_method,
          total_amount,
          products,
          status: "Pending",
        },
      ])
      .select();

    if (error) throw error;

    res.status(201).json({
      success: true,
      message: "Order created successfully.",
      order: data[0],
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get All Orders
 * GET /api/orders
 */
export const getOrders = async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from("orders")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) throw error;

    res.json({
      success: true,
      total: data.length,
      orders: data,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get Order By ID
 * GET /api/orders/:id
 */
export const getOrderById = async (req, res, next) => {
  try {
    const { id } = req.params;

    const { data, error } = await supabase
      .from("orders")
      .select("*")
      .eq("id", id)
      .single();

    if (error) throw error;

    if (!data) {
      return res.status(404).json({
        success: false,
        message: "Order not found.",
      });
    }

    res.json({
      success: true,
      order: data,
    });
  } catch (error) {
    next(error);
  }
};