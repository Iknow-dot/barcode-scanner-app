import json
from flask import Blueprint, jsonify, request, abort, current_app  # Import current_app for logging
from flask_jwt_extended import jwt_required, get_jwt_identity
from app.models import User, Organization
from ..decorators import role_required
import uuid
import requests
import base64

# Create a blueprint for product-related routes
product_bp = Blueprint('product', __name__, url_prefix='/products')

@product_bp.route('/scan', methods=['POST'])
@jwt_required()
@role_required('user')
def scan_barcode():
    data = request.get_json()
    current_app.logger.info(f"Received data: {data}")  # Log the incoming request data

    if not data or 'barcode' not in data:
        abort(400, description="Missing barcode or data")
        
    barcode = data.get('barcode')
    isBarcode = 'true' if data.get('searchType') == 'barcode' else 'false'
    warehouses = data.get('warehouseCodes', ',')

    if not barcode:
        abort(400, description="Missing barcode")

    user_id = get_jwt_identity()
    user = User.query.get(uuid.UUID(user_id))
    organization = Organization.query.get(user.organization_id)

    if not organization or not organization.web_service_url:
        abort(404, description="No web service URL found for the organization")

    decrypted_password = organization.decrypt_password()
    credentials = f"{organization.org_username}:{decrypted_password}"
    headers = {
        'Authorization': 'Basic ' + base64.b64encode(credentials.encode()).decode(),
        'IsBarcode': isBarcode,
        'Warehouse': warehouses,
        'Sku': barcode,
        'Content-Type': 'application/json; charset=utf-8'
    }

    current_app.logger.info(f"Making request to {organization.web_service_url} with headers {headers}")

    try:
        response = requests.get(organization.web_service_url, headers=headers)
        response.raise_for_status()

        try:
            # Try decoding with BOM removal
            response_text = response.content.decode('utf-8-sig')
            product_data = json.loads(response_text)
        except UnicodeDecodeError:
            # If there's a decode error, fall back to standard utf-8
            product_data = response.json()

        if not product_data:
            return jsonify({"message": "Product not found"}), 404

        return jsonify(product_data), 200

    except requests.RequestException as e:
        current_app.logger.error(f"External service error: {str(e)}")
        abort(500, description=f"External service error: {str(e)}")

    except Exception as e:
        current_app.logger.error(f"Internal error: {str(e)}")
        abort(500, description=f"Internal error: {str(e)}")
