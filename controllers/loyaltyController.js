export const getPoints = async (req, res) => {
  const { mobile_number, cart_value } = req.body;

  return res.json({
    data: {
      mobile_number,
      available_points: 1000,
      applicable_points: 50,
    },
  });
};

export const blockPoints = async (req, res) => {
  const { mobile_number, transactional_points, order_id } = req.body;

  return res.json({
    data: {
      status: true,
      available_points: 950,
      debited_points: transactional_points,
      transaction_id: order_id,
      discount_value: transactional_points,
      additional_properties: {
        redemptionFactor: 1,
      },
    },
  });
};

export const unblockPoints = async (req, res) => {
  return res.json({
    data: {
      status: "Success",
    },
  });
};