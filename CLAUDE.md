need to complete parseContainer
direction horizontal/vertical: flex-box like calculation, remember to calculate gap too
Anchor: it can affect the draw position of a child too?
scroll: need a width or height to activate
wrap: activate when there is width/height

so to parse container:
I need to calculate the position of the children as well as the width and height of the contaienr:
	- I can calculate the width and height of the contaienr by going through the children and parsing them. Then get the width and height as well as their position + the position after by direction vertical/horizontal (this need to be calculated before parsing them)
	- Position affected by direction vertical/horizontal: x_pos=xOriginalPos + i * (w_prev+gap) (same goes for vertical)
		-In case of wrap you need to get the highest of the last row as highest_last_row:
			y_pos = yOriginalPos + i * (highest_last_row+gap)
    - If wrap is true than we need width and height in the original container element to be defined as well
        then we need to calculate the width/height of the children to do wrap properly(proably putting something like a variable outside of the loop call currentCombinedWidth/currentCombinedHeight to check for overflow and wrap them. If so remember to check the width/height after they have been pause then combine with that variable to check if they have been overflowed. If yes then reset the variable and change the position of this new element to wrap and also add the widht/height of the elemnt to the combined variable)