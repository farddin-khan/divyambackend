import supabase from "../../src/config/supabase.js";

/**
 * Add Review
 * POST /api/reviews
 */
export const createReview = async (req, res) => {
  try {
    const {
      product_id,
      name,
      email,
      rating,
      review
    } = req.body;

    if (!product_id || !name || !rating || !review) {
      return res.status(400).json({
        success: false,
        message: "Required fields are missing."
      });
    }

    const { data, error } = await supabase
      .from("reviews")
      .insert([
        {
          product_id,
          name,
          email,
          rating,
          review,
          approved: false
        }
      ])
      .select();

    if (error) throw error;

    res.status(201).json({
      success: true,
      message: "Review submitted successfully. Waiting for approval.",
      review: data[0]
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

/**
 * Get All Reviews
 * GET /api/reviews
 */
export const getReviews = async (req, res) => {
  try {

    const { data, error } = await supabase
      .from("reviews")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) throw error;

    res.json({
      success: true,
      total: data.length,
      reviews: data
    });

  } catch (error) {

    res.status(500).json({
      success: false,
      message: error.message
    });

  }
};

/**
 * Get Approved Reviews
 * GET /api/reviews/approved
 */
export const getApprovedReviews = async (req, res) => {

  try {

    const { data, error } = await supabase
      .from("reviews")
      .select("*")
      .eq("approved", true)
      .order("created_at", { ascending: false });

    if (error) throw error;

    res.json({
      success: true,
      total: data.length,
      reviews: data
    });

  } catch (error) {

    res.status(500).json({
      success: false,
      message: error.message
    });

  }

};

/**
 * Reviews By Product
 * GET /api/reviews/product/:productId
 */
export const getReviewsByProduct = async (req, res) => {

  try {

    const { productId } = req.params;

    const { data, error } = await supabase
      .from("reviews")
      .select("*")
      .eq("product_id", productId)
      .eq("approved", true)
      .order("created_at", { ascending: false });

    if (error) throw error;

    res.json({
      success: true,
      total: data.length,
      reviews: data
    });

  } catch (error) {

    res.status(500).json({
      success: false,
      message: error.message
    });

  }

};

/**
 * Approve Review
 * PATCH /api/reviews/:id/approve
 */
export const approveReview = async (req, res) => {

  try {

    const { id } = req.params;

    const { data, error } = await supabase
      .from("reviews")
      .update({
        approved: true
      })
      .eq("id", id)
      .select();

    if (error) throw error;

    res.json({
      success: true,
      message: "Review approved successfully.",
      review: data[0]
    });

  } catch (error) {

    res.status(500).json({
      success: false,
      message: error.message
    });

  }

};

/**
 * Reject Review
 * PATCH /api/reviews/:id/reject
 */
export const rejectReview = async (req, res) => {

  try {

    const { id } = req.params;

    const { data, error } = await supabase
      .from("reviews")
      .update({
        approved: false
      })
      .eq("id", id)
      .select();

    if (error) throw error;

    res.json({
      success: true,
      message: "Review rejected.",
      review: data[0]
    });

  } catch (error) {

    res.status(500).json({
      success: false,
      message: error.message
    });

  }

};

/**
 * Delete Review
 * DELETE /api/reviews/:id
 */
export const deleteReview = async (req, res) => {

  try {

    const { id } = req.params;

    const { error } = await supabase
      .from("reviews")
      .delete()
      .eq("id", id);

    if (error) throw error;

    res.json({
      success: true,
      message: "Review deleted successfully."
    });

  } catch (error) {

    res.status(500).json({
      success: false,
      message: error.message
    });

  }

};