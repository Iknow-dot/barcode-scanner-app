from flask import Blueprint, jsonify, current_app
from flask_jwt_extended import jwt_required, get_jwt_identity
from app.models import UserWarehouse, Warehouse
from ..models import db
import uuid

# Create a blueprint for user_warehouse-related routes
user_warehouse_bp = Blueprint('user_warehouse', __name__, url_prefix='/user-warehouses')

@user_warehouse_bp.route('/user', methods=['GET'])
@jwt_required()
def get_user_warehouses():
    """
    Route to fetch the warehouses associated with the currently logged-in user.
    """
    try:
        # Get the current user's ID from the JWT token
        user_id = get_jwt_identity()
        
        # Query the user's warehouses from the user_warehouses table
        user_warehouses = db.session.query(Warehouse).join(UserWarehouse).filter(UserWarehouse.user_id == uuid.UUID(user_id)).all()

        if not user_warehouses:
            return jsonify({"error": "No warehouses found for this user"}), 404

        # Prepare and return a list of warehouse data
        warehouses_data = [{'id': str(warehouse.id), 'code': warehouse.code, 'name': warehouse.name} for warehouse in user_warehouses]
        return jsonify(warehouses_data), 200

    except Exception as e:
        current_app.logger.error(f"Error fetching warehouses for user {user_id}: {str(e)}")
        return jsonify({"error": "An error occurred while fetching warehouses."}), 500
