from flask import Blueprint, jsonify, request, abort
from flask_jwt_extended import jwt_required, get_jwt_identity
from ..models import User, Organization  # Ensure Product is not imported
import requests
import base64

product_bp = Blueprint('product', __name__)

@product_bp.route('/scan', methods=['POST'])
@jwt_required()
def scan_barcode():
    data = request.get_json()
    barcode = data.get('barcode')
    isBarcode = 'true' if data.get('searchType') == 'barcode' else 'false'
    warehouses = data.get('warehouseCodes', '')

    if not barcode:
        abort(400, description="Missing barcode")

    identity = get_jwt_identity()
    user_id = identity['user_id']
    current_user = User.query.get(user_id)
    organization = Organization.query.get(current_user.organization_id)

    if not organization or not organization.web_service_url:
        abort(404, description="No web service URL found for the organization")

    encoded_credentials = base64.b64encode(f"{organization.org_username}:{organization.org_password}".encode()).decode('utf-8')
    headers = {
        'Authorization': f'Basic {encoded_credentials}',
        'IsBarcode': isBarcode,
        'Warehouse': warehouses,
        'Sku': barcode,
        'Content-Type': 'application/json; charset=utf-8'
    }

    try:
        response = requests.get(organization.web_service_url, headers=headers)
        response.raise_for_status()
        return jsonify(response.json()), 200

    except requests.RequestException as e:
        abort(500, description=f"External service error: {str(e)}")

    except Exception as e:
        abort(500, description=f"Internal error: {str(e)}")

    return jsonify({"message": "Product not found"}), 404
